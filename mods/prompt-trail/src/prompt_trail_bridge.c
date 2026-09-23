#define _DARWIN_C_SOURCE

#include "prompt_trail_common.h"
#include "prompt_trail_generated_artifact.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <libproc.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define LOCATOR_VERSION 1
#define PLUGIN_PROTOCOL 1

static void fail(const char *category) {
  fprintf(stderr, "{\"category\":\"%s\"}\n", category);
  exit(1);
}

static bool owned_directory(const char *path) {
  struct stat status;
  return lstat(path, &status) == 0
    && S_ISDIR(status.st_mode)
    && status.st_uid == geteuid()
    && !pt_has_extended_acl(path);
}

static bool trusted_directory(const char *path) {
  struct stat status;
  return lstat(path, &status) == 0
    && S_ISDIR(status.st_mode)
    && (status.st_uid == 0 || status.st_uid == geteuid())
    && (status.st_mode & 0022) == 0
    && !pt_has_write_grant_acl(path);
}

static bool trusted_directory_chain(const char *path) {
  if (!path || path[0] != '/') return false;

  char current[PATH_MAX] = "/";
  if (!trusted_directory(current)) return false;
  size_t used = 1;
  const char *cursor = path + 1;
  while (*cursor != '\0') {
    const char *separator = strchr(cursor, '/');
    size_t component_length = separator
      ? (size_t)(separator - cursor)
      : strlen(cursor);
    if (component_length == 0) {
      cursor = separator ? separator + 1 : cursor + 1;
      continue;
    }
    if ((used > 1 && used + 1 >= sizeof(current))
        || used + component_length >= sizeof(current)) {
      return false;
    }
    if (used > 1) current[used++] = '/';
    memcpy(current + used, cursor, component_length);
    used += component_length;
    current[used] = '\0';
    if (!trusted_directory(current)) return false;
    if (!separator) break;
    cursor = separator + 1;
  }
  return true;
}

static void ensure_directory(const char *path, bool private_directory) {
  if (mkdir(path, 0700) != 0 && errno != EEXIST) fail("locator-directory");
  if (!owned_directory(path)) fail("locator-directory-untrusted");
  if (private_directory && !pt_ensure_private_directory(path)) {
    fail("locator-directory-permissions");
  }
}

static void locator_directory(char output[PATH_MAX]) {
  const char *home = getenv("HOME");
  if (!home || home[0] != '/') fail("home-unavailable");

  char path[PATH_MAX];
  int length = snprintf(path, sizeof(path), "%s/.claude", home);
  if (length < 0 || (size_t)length >= sizeof(path)) fail("locator-path");
  ensure_directory(path, false);

  const char *components[] = {
    "plugins",
    "data",
    ".function-hook-locators",
    "prompt-trail",
  };
  for (size_t index = 0; index < sizeof(components) / sizeof(components[0]); index += 1) {
    size_t used = strlen(path);
    length = snprintf(path + used, sizeof(path) - used, "/%s", components[index]);
    if (length < 0 || (size_t)length >= sizeof(path) - used) fail("locator-path");
    ensure_directory(path, index >= 2);
  }
  memcpy(output, path, strlen(path) + 1);
}

static void require_canonical(const char *path, char output[PATH_MAX], const char *category) {
  if (!realpath(path, output)) fail(category);
}

static void require_plugin_paths(
  const char *plugin_root_argument,
  const char *plugin_data_argument,
  const char *helper_argument,
  const char *manifest_argument,
  char plugin_root[PATH_MAX],
  char plugin_data[PATH_MAX],
  char helper_path[PATH_MAX],
  char manifest_path[PATH_MAX]
) {
  require_canonical(plugin_root_argument, plugin_root, "plugin-root");
  require_canonical(plugin_data_argument, plugin_data, "plugin-data");
  if (!trusted_directory_chain(plugin_root)) fail("plugin-root-untrusted");

  char component_path[PATH_MAX];
  int component_length = snprintf(
    component_path,
    sizeof(component_path),
    "%s/bin",
    plugin_root
  );
  if (component_length < 0
      || (size_t)component_length >= sizeof(component_path)
      || !trusted_directory(component_path)) {
    fail("plugin-bin-untrusted");
  }
  component_length = snprintf(
    component_path,
    sizeof(component_path),
    "%s/artifacts",
    plugin_root
  );
  if (component_length < 0
      || (size_t)component_length >= sizeof(component_path)
      || !trusted_directory(component_path)) {
    fail("plugin-artifacts-untrusted");
  }

  struct stat data_status;
  if (lstat(plugin_data, &data_status) != 0
      || !S_ISDIR(data_status.st_mode)
      || data_status.st_uid != geteuid()
      || pt_has_extended_acl(plugin_data)) {
    fail("plugin-data-untrusted");
  }
  if ((data_status.st_mode & 0777) != 0700 && chmod(plugin_data, 0700) != 0) {
    fail("plugin-data-permissions");
  }

  int length = snprintf(
    helper_path,
    PATH_MAX,
    "%s/bin/prompt-trail-helper",
    plugin_root
  );
  if (length < 0 || length >= PATH_MAX || strcmp(helper_path, helper_argument) != 0) {
    fail("helper-path");
  }
  length = snprintf(
    manifest_path,
    PATH_MAX,
    "%s/artifacts/helper-manifest.json",
    plugin_root
  );
  if (length < 0 || length >= PATH_MAX || strcmp(manifest_path, manifest_argument) != 0) {
    fail("manifest-path");
  }
}

static const char *artifact_status(const char *helper_path, const char *manifest_path) {
  struct stat manifest_status;
  if (lstat(manifest_path, &manifest_status) != 0) return "manifest-missing";
  if (!S_ISREG(manifest_status.st_mode)
      || manifest_status.st_uid != geteuid()
      || (manifest_status.st_mode & 0022) != 0
      || pt_has_write_grant_acl(manifest_path)) {
    return "manifest-untrusted";
  }

  char *manifest = NULL;
  char manifest_sha[65];
  int64_t manifest_format = 0;
  int64_t manifest_protocol = 0;
  if (!pt_read_file(manifest_path, &manifest, NULL)
      || !pt_json_validate(manifest)
      || !pt_json_get_i64(manifest, "formatVersion", &manifest_format)
      || !pt_json_get_i64(manifest, "helperProtocol", &manifest_protocol)
      || !pt_json_get_string(
        manifest,
        "sha256",
        manifest_sha,
        sizeof(manifest_sha)
      )
      || manifest_format != 1
      || manifest_protocol != PT_HELPER_PROTOCOL
      || strcmp(manifest_sha, PT_EXPECTED_HELPER_SHA256) != 0) {
    free(manifest);
    return "manifest-invalid";
  }
  free(manifest);

  struct stat helper_status;
  if (lstat(helper_path, &helper_status) != 0) return "helper-missing";
  if (!S_ISREG(helper_status.st_mode)) return "helper-not-regular";
  if (helper_status.st_uid != geteuid()
      || (helper_status.st_mode & 0022) != 0
      || pt_has_write_grant_acl(helper_path)) {
    return "helper-untrusted";
  }
  if (access(helper_path, X_OK) != 0) return "helper-not-executable";

  char actual_sha[65];
  if (!pt_sha256_file(helper_path, actual_sha)) return "helper-hash-unproven";
  return strcmp(actual_sha, PT_EXPECTED_HELPER_SHA256) == 0
    ? "trusted"
    : "digest-mismatch";
}

static void write_literal(int descriptor, const char *text) {
  size_t remaining = strlen(text);
  while (remaining > 0) {
    ssize_t written = write(descriptor, text, remaining);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) fail("locator-write");
    text += written;
    remaining -= (size_t)written;
  }
}

static void write_key_string(
  int descriptor,
  const char *prefix,
  const char *value
) {
  write_literal(descriptor, prefix);
  pt_write_json_string(descriptor, value);
}

static bool process_generation_ended(
  pid_t pid,
  int64_t expected_seconds,
  int64_t expected_microseconds
) {
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t actual_seconds = 0;
  int64_t actual_microseconds = 0;
  if (pt_process_identity(
        pid,
        executable,
        sizeof(executable),
        &actual_seconds,
        &actual_microseconds
      )) {
    return actual_seconds != expected_seconds
      || actual_microseconds != expected_microseconds;
  }
  errno = 0;
  return kill(pid, 0) != 0 && errno == ESRCH;
}

static void remove_proven_stale_locators(const char *directory) {
  DIR *stream = opendir(directory);
  if (!stream) return;

  struct dirent *entry = NULL;
  while ((entry = readdir(stream)) != NULL) {
    size_t name_length = strlen(entry->d_name);
    if (name_length <= 5
        || strcmp(entry->d_name + name_length - 5, ".json") != 0) {
      continue;
    }

    char path[PATH_MAX];
    int path_length = snprintf(
      path,
      sizeof(path),
      "%s/%s",
      directory,
      entry->d_name
    );
    if (path_length < 0 || (size_t)path_length >= sizeof(path)
        || !pt_path_is_private_file(path)) {
      continue;
    }

    char *locator = NULL;
    char session_id[129];
    int64_t locator_version = 0;
    int64_t plugin_protocol = 0;
    int64_t helper_protocol = 0;
    int64_t host_pid = 0;
    int64_t host_start_seconds = 0;
    int64_t host_start_microseconds = 0;
    if (!pt_read_file(path, &locator, NULL)
        || !pt_json_validate(locator)
        || !pt_json_get_i64(locator, "locatorVersion", &locator_version)
        || !pt_json_get_i64(locator, "pluginProtocol", &plugin_protocol)
        || !pt_json_get_i64(locator, "helperProtocol", &helper_protocol)
        || !pt_json_get_i64(locator, "hostPid", &host_pid)
        || !pt_json_get_i64(
          locator,
          "hostStartSeconds",
          &host_start_seconds
        )
        || !pt_json_get_i64(
          locator,
          "hostStartMicroseconds",
          &host_start_microseconds
        )
        || !pt_json_get_string(
          locator,
          "sessionId",
          session_id,
          sizeof(session_id)
        )
        || locator_version != LOCATOR_VERSION
        || plugin_protocol != PLUGIN_PROTOCOL
        || helper_protocol != PT_HELPER_PROTOCOL
        || host_pid <= 0
        || host_pid > INT_MAX
        || !pt_is_safe_identifier(session_id)) {
      free(locator);
      continue;
    }
    free(locator);

    char expected_name[sizeof(session_id) + 6];
    int expected_length = snprintf(
      expected_name,
      sizeof(expected_name),
      "%s.json",
      session_id
    );
    if (expected_length < 0
        || (size_t)expected_length >= sizeof(expected_name)
        || strcmp(expected_name, entry->d_name) != 0
        || !process_generation_ended(
          (pid_t)host_pid,
          host_start_seconds,
          host_start_microseconds
        )) {
      continue;
    }

    (void)unlink(path);
  }
  closedir(stream);
}

typedef struct {
  char path[PATH_MAX];
  char session_id[129];
  char plugin_root[PATH_MAX];
  char run_id[129];
  char archive_generation[129];
  int64_t host_pid;
  int64_t host_start_seconds;
  int64_t host_start_microseconds;
} ContinuityLocator;

static bool read_continuity_locator(
  const char *directory,
  const char *name,
  ContinuityLocator *output
) {
  size_t name_length = strlen(name);
  if (name_length <= 5 || strcmp(name + name_length - 5, ".json") != 0) {
    return false;
  }

  int path_length = snprintf(
    output->path,
    sizeof(output->path),
    "%s/%s",
    directory,
    name
  );
  if (path_length < 0 || (size_t)path_length >= sizeof(output->path)
      || !pt_path_is_private_file(output->path)) {
    return false;
  }

  char *locator = NULL;
  int64_t locator_version = 0;
  int64_t plugin_protocol = 0;
  int64_t helper_protocol = 0;
  bool valid = pt_read_file(output->path, &locator, NULL)
    && pt_json_validate(locator)
    && pt_json_get_i64(locator, "locatorVersion", &locator_version)
    && pt_json_get_i64(locator, "pluginProtocol", &plugin_protocol)
    && pt_json_get_i64(locator, "helperProtocol", &helper_protocol)
    && pt_json_get_i64(locator, "hostPid", &output->host_pid)
    && pt_json_get_i64(
      locator,
      "hostStartSeconds",
      &output->host_start_seconds
    )
    && pt_json_get_i64(
      locator,
      "hostStartMicroseconds",
      &output->host_start_microseconds
    )
    && pt_json_get_string(
      locator,
      "sessionId",
      output->session_id,
      sizeof(output->session_id)
    )
    && pt_json_get_string(
      locator,
      "pluginRoot",
      output->plugin_root,
      sizeof(output->plugin_root)
    )
    && pt_json_get_string(
      locator,
      "runId",
      output->run_id,
      sizeof(output->run_id)
    )
    && pt_json_get_string(
      locator,
      "archiveGeneration",
      output->archive_generation,
      sizeof(output->archive_generation)
    )
    && locator_version == LOCATOR_VERSION
    && plugin_protocol == PLUGIN_PROTOCOL
    && helper_protocol == PT_HELPER_PROTOCOL
    && output->host_pid > 0
    && output->host_pid <= INT_MAX
    && pt_is_safe_identifier(output->session_id)
    && pt_is_safe_identifier(output->run_id)
    && pt_is_safe_identifier(output->archive_generation);
  free(locator);
  if (!valid) return false;

  char expected_name[sizeof(output->session_id) + 6];
  int expected_length = snprintf(
    expected_name,
    sizeof(expected_name),
    "%s.json",
    output->session_id
  );
  return expected_length >= 0
    && (size_t)expected_length < sizeof(expected_name)
    && strcmp(expected_name, name) == 0;
}

static bool same_host_locator(
  const ContinuityLocator *locator,
  const char *plugin_root,
  pid_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds
) {
  return locator->host_pid == host_pid
    && locator->host_start_seconds == host_start_seconds
    && locator->host_start_microseconds == host_start_microseconds
    && strcmp(locator->plugin_root, plugin_root) == 0;
}

static bool load_predecessor_identity(
  const char *directory,
  const char *plugin_root,
  pid_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds,
  char run_id[129],
  char archive_generation[129]
) {
  DIR *stream = opendir(directory);
  if (!stream) return false;

  size_t matches = 0;
  run_id[0] = '\0';
  archive_generation[0] = '\0';
  struct dirent *entry = NULL;
  while ((entry = readdir(stream)) != NULL) {
    ContinuityLocator locator;
    if (!read_continuity_locator(directory, entry->d_name, &locator)
        || !same_host_locator(
          &locator,
          plugin_root,
          host_pid,
          host_start_seconds,
          host_start_microseconds
        )) {
      continue;
    }

    if (run_id[0] != '\0'
        && (strcmp(run_id, locator.run_id) != 0
          || strcmp(archive_generation, locator.archive_generation) != 0)) {
      closedir(stream);
      fail("locator-predecessor-ambiguous");
    }
    if (run_id[0] == '\0') {
      snprintf(run_id, 129, "%s", locator.run_id);
      snprintf(
        archive_generation,
        129,
        "%s",
        locator.archive_generation
      );
    }
    matches += 1;
  }
  closedir(stream);
  return matches > 0;
}

static void remove_predecessors(
  const char *directory,
  const char *session_id,
  const char *plugin_root,
  pid_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds,
  const char *run_id,
  const char *archive_generation
) {
  DIR *stream = opendir(directory);
  if (!stream) fail("locator-directory");

  struct dirent *entry = NULL;
  while ((entry = readdir(stream)) != NULL) {
    ContinuityLocator locator;
    if (!read_continuity_locator(directory, entry->d_name, &locator)
        || !same_host_locator(
          &locator,
          plugin_root,
          host_pid,
          host_start_seconds,
          host_start_microseconds
        )
        || strcmp(locator.run_id, run_id) != 0
        || strcmp(locator.archive_generation, archive_generation) != 0
        || strcmp(locator.session_id, session_id) == 0) {
      continue;
    }
    if (unlink(locator.path) != 0) {
      closedir(stream);
      fail("locator-predecessor-remove");
    }
  }
  closedir(stream);
}

static void publish_locator(
  const char *session_id,
  const char *source,
  const char *plugin_root,
  const char *plugin_data,
  const char *helper_path,
  const char *manifest_path
) {
  char directory[PATH_MAX];
  locator_directory(directory);
  remove_proven_stale_locators(directory);

  char locator_path[PATH_MAX];
  char temporary_path[PATH_MAX];
  char temporary_id[37];
  pt_random_uuid(temporary_id);
  int length = snprintf(
    locator_path,
    sizeof(locator_path),
    "%s/%s.json",
    directory,
    session_id
  );
  if (length < 0 || (size_t)length >= sizeof(locator_path)) fail("locator-path");
  length = snprintf(
    temporary_path,
    sizeof(temporary_path),
    "%s/.%s.tmp",
    directory,
    temporary_id
  );
  if (length < 0 || (size_t)length >= sizeof(temporary_path)) fail("locator-path");

  pid_t host_pid = getppid();
  char host_executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t host_start_seconds = 0;
  int64_t host_start_microseconds = 0;
  if (!pt_process_identity(
        host_pid,
        host_executable,
        sizeof(host_executable),
        &host_start_seconds,
        &host_start_microseconds
      )) {
    fail("host-generation-unproven");
  }
  char host_version[64] = "unproven";
  (void)pt_executable_version(host_executable, host_version, sizeof(host_version));

  /* A Run is one host process generation. A `/clear` or an in-process
     `/resume` changes the classic session inside the same process, so it
     inherits the identity a locator of this very generation already holds; a
     `/clear` without one fails closed rather than inventing a Run. `startup`
     and `fork` always begin a new process and so a new Run, and so does a
     `resume` in a new process: nothing it inherited from its parent's
     environment can prove the same generation. */
  char run_id[129];
  char archive_generation[129];
  bool inherits = strcmp(source, "clear") == 0 || strcmp(source, "resume") == 0;
  bool inherited = inherits && load_predecessor_identity(
    directory,
    plugin_root,
    host_pid,
    host_start_seconds,
    host_start_microseconds,
    run_id,
    archive_generation
  );
  if (strcmp(source, "clear") == 0 && !inherited) {
    fail("locator-predecessor-missing");
  }
  if (!inherited) {
    pt_random_uuid(run_id);
    pt_random_uuid(archive_generation);
  }

  char database_root[PATH_MAX];
  length = snprintf(database_root, sizeof(database_root), "%s/archives", plugin_data);
  if (length < 0 || (size_t)length >= sizeof(database_root)) fail("database-root");

  const char *status = artifact_status(helper_path, manifest_path);
  mode_t previous_umask = umask(0077);
  int descriptor = open(
    temporary_path,
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    0600
  );
  if (descriptor < 0) fail("locator-create");

  dprintf(
    descriptor,
    "{\"locatorVersion\":%d,\"pluginProtocol\":%d,\"helperProtocol\":%d,",
    LOCATOR_VERSION,
    PLUGIN_PROTOCOL,
    PT_HELPER_PROTOCOL
  );
  write_key_string(descriptor, "\"sessionId\":", session_id);
  dprintf(
    descriptor,
    ",\"hostPid\":%d,\"hostStartSeconds\":%lld,\"hostStartMicroseconds\":%lld,",
    host_pid,
    (long long)host_start_seconds,
    (long long)host_start_microseconds
  );
  write_key_string(descriptor, "\"hostExecutable\":", host_executable);
  write_key_string(descriptor, ",\"hostVersion\":", host_version);
  write_key_string(descriptor, ",\"pluginRoot\":", plugin_root);
  write_key_string(descriptor, ",\"pluginData\":", plugin_data);
  write_key_string(descriptor, ",\"databaseRoot\":", database_root);
  write_key_string(descriptor, ",\"helperPath\":", helper_path);
  write_key_string(descriptor, ",\"manifestPath\":", manifest_path);
  write_key_string(
    descriptor,
    ",\"helperSha256\":",
    PT_EXPECTED_HELPER_SHA256
  );
  write_key_string(descriptor, ",\"artifactStatus\":", status);
  write_key_string(descriptor, ",\"runId\":", run_id);
  write_key_string(
    descriptor,
    ",\"archiveGeneration\":",
    archive_generation
  );
  write_literal(descriptor, "}\n");

  if (fsync(descriptor) != 0 || close(descriptor) != 0) {
    unlink(temporary_path);
    fail("locator-flush");
  }
  if (!pt_path_is_private_file(temporary_path)) {
    unlink(temporary_path);
    fail("locator-permissions");
  }
  if (rename(temporary_path, locator_path) != 0) {
    unlink(temporary_path);
    fail("locator-publish");
  }
  if (!pt_path_is_private_file(locator_path)) {
    unlink(locator_path);
    fail("locator-permissions");
  }
  if (inherited) {
    remove_predecessors(
      directory,
      session_id,
      plugin_root,
      host_pid,
      host_start_seconds,
      host_start_microseconds,
      run_id,
      archive_generation
    );
  }
  int directory_descriptor = open(directory, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (directory_descriptor < 0 || fsync(directory_descriptor) != 0) {
    if (directory_descriptor >= 0) close(directory_descriptor);
    fail("locator-directory-flush");
  }
  close(directory_descriptor);
  umask(previous_umask);
}

static void remove_locator(
  const char *session_id,
  const char *expected_plugin_root
) {
  char directory[PATH_MAX];
  locator_directory(directory);
  char locator_path[PATH_MAX];
  int length = snprintf(
    locator_path,
    sizeof(locator_path),
    "%s/%s.json",
    directory,
    session_id
  );
  if (length < 0 || (size_t)length >= sizeof(locator_path)) fail("locator-path");
  if (access(locator_path, F_OK) != 0 && errno == ENOENT) return;
  if (!pt_path_is_private_file(locator_path)) fail("locator-untrusted");

  char *locator = NULL;
  char stored_session[129];
  char stored_plugin_root[PATH_MAX];
  int64_t locator_version = 0;
  int64_t host_pid = 0;
  int64_t host_start_seconds = 0;
  int64_t host_start_microseconds = 0;
  if (!pt_read_file(locator_path, &locator, NULL)
      || !pt_json_validate(locator)
      || !pt_json_get_i64(locator, "locatorVersion", &locator_version)
      || !pt_json_get_string(
        locator,
        "sessionId",
        stored_session,
        sizeof(stored_session)
      )
      || !pt_json_get_string(
        locator,
        "pluginRoot",
        stored_plugin_root,
        sizeof(stored_plugin_root)
      )
      || !pt_json_get_i64(locator, "hostPid", &host_pid)
      || !pt_json_get_i64(locator, "hostStartSeconds", &host_start_seconds)
      || !pt_json_get_i64(locator, "hostStartMicroseconds", &host_start_microseconds)
      || locator_version != LOCATOR_VERSION
      || strcmp(stored_session, session_id) != 0
      || strcmp(stored_plugin_root, expected_plugin_root) != 0
      || host_pid != getppid()
      || !pt_process_is_same(
        (pid_t)host_pid,
        host_start_seconds,
        host_start_microseconds
      )) {
    free(locator);
    fail("locator-mismatch");
  }
  free(locator);
  if (unlink(locator_path) != 0) fail("locator-remove");
}

static void usage(void) {
  fail("invalid-command");
}

int main(int argc, char **argv) {
  umask(0077);
  if (argc != 6) usage();

  char *input = NULL;
  if (!pt_read_fd(STDIN_FILENO, &input, NULL) || !pt_json_validate(input)) {
    free(input);
    fail("hook-input");
  }
  char session_id[129];
  char event_name[64];
  if (!pt_json_get_string(input, "session_id", session_id, sizeof(session_id))
      || !pt_json_get_string(
        input,
        "hook_event_name",
        event_name,
        sizeof(event_name)
      )
      || !pt_is_safe_identifier(session_id)) {
    free(input);
    fail("hook-input");
  }

  char plugin_root[PATH_MAX];
  char plugin_data[PATH_MAX];
  char helper_path[PATH_MAX];
  char manifest_path[PATH_MAX];
  require_plugin_paths(
    argv[2],
    argv[3],
    argv[4],
    argv[5],
    plugin_root,
    plugin_data,
    helper_path,
    manifest_path
  );

  if (strcmp(argv[1], "publish") == 0
      && strcmp(event_name, "SessionStart") == 0) {
    char source[64];
    if (!pt_json_get_string(input, "source", source, sizeof(source))
        || (strcmp(source, "startup") != 0
          && strcmp(source, "resume") != 0
          && strcmp(source, "fork") != 0
          && strcmp(source, "clear") != 0)) {
      free(input);
      usage();
    }
    publish_locator(
      session_id,
      source,
      plugin_root,
      plugin_data,
      helper_path,
      manifest_path
    );
  } else if (strcmp(argv[1], "remove") == 0
      && strcmp(event_name, "SessionEnd") == 0) {
    char reason[64];
    if (!pt_json_get_string(input, "reason", reason, sizeof(reason))) {
      free(input);
      usage();
    }
    /* A `/clear` or an in-process `/resume` hands the Run to the next
       classic session of the same process, whose publish reads its identity
       from this locator and then removes it. */
    if (strcmp(reason, "clear") != 0 && strcmp(reason, "resume") != 0) {
      remove_locator(session_id, plugin_root);
    }
  } else {
    free(input);
    usage();
  }

  free(input);
  return 0;
}

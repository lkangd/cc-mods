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
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
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

/* One locator per process that has a classic session open: two processes
   resuming the same session each keep their own, instead of the later one
   overwriting the earlier one's. The name repeats the identity the locator
   holds, so it can be checked rather than trusted (`pt_read_locator`). A bare
   `<session>.json` is the name every locator had before; it is still
   recognised, so one left behind by an older build is cleaned up rather than
   stranded. */
static void remove_proven_stale_locators(const char *directory) {
  DIR *stream = opendir(directory);
  if (!stream) return;

  struct dirent *entry = NULL;
  while ((entry = readdir(stream)) != NULL) {
    PtLocatorIdentity identity;
    char *locator = NULL;
    if (!pt_read_locator(directory, entry->d_name, &identity, &locator)) continue;
    int64_t locator_version = 0;
    int64_t plugin_protocol = 0;
    int64_t helper_protocol = 0;
    bool current = pt_json_get_i64(locator, "locatorVersion", &locator_version)
      && pt_json_get_i64(locator, "pluginProtocol", &plugin_protocol)
      && pt_json_get_i64(locator, "helperProtocol", &helper_protocol)
      && locator_version == LOCATOR_VERSION
      && plugin_protocol == PLUGIN_PROTOCOL
      && helper_protocol == PT_HELPER_PROTOCOL;
    free(locator);
    if (!current
        || !pt_process_generation_ended(
          (pid_t)identity.host_pid,
          identity.host_start_seconds,
          identity.host_start_microseconds
        )) {
      continue;
    }

    (void)unlink(identity.path);
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
  PtLocatorIdentity identity;
  char *locator = NULL;
  if (!pt_read_locator(directory, name, &identity, &locator)) return false;

  int64_t locator_version = 0;
  int64_t plugin_protocol = 0;
  int64_t helper_protocol = 0;
  bool valid = pt_json_get_i64(locator, "locatorVersion", &locator_version)
    && pt_json_get_i64(locator, "pluginProtocol", &plugin_protocol)
    && pt_json_get_i64(locator, "helperProtocol", &helper_protocol)
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
    && pt_is_safe_identifier(output->run_id)
    && pt_is_safe_identifier(output->archive_generation);
  free(locator);
  if (!valid) return false;

  snprintf(output->path, sizeof(output->path), "%s", identity.path);
  snprintf(output->session_id, sizeof(output->session_id), "%s", identity.session_id);
  output->host_pid = identity.host_pid;
  output->host_start_seconds = identity.host_start_seconds;
  output->host_start_microseconds = identity.host_start_microseconds;
  return true;
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

/* Whether a live process other than this one is attached to the Run. One Run
   has one Active Branch, so a second process resuming the same session is not
   allowed to share it: it begins a Run of its own instead, as a fork would. A
   holder whose process has gone no longer holds anything, and neither does
   one still showing a session of `handed_off`, whose conversation has since
   moved on to the one now taking the Run up. */
static bool run_held_elsewhere(
  const char *directory,
  const char *run_id,
  const char (*handed_off)[129],
  size_t handed_off_count,
  pid_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds
) {
  DIR *stream = opendir(directory);
  if (!stream) fail("locator-directory");

  bool held = false;
  struct dirent *entry = NULL;
  while (!held && (entry = readdir(stream)) != NULL) {
    ContinuityLocator locator;
    if (!read_continuity_locator(directory, entry->d_name, &locator)
        || strcmp(locator.run_id, run_id) != 0) {
      continue;
    }
    bool moved_on = false;
    for (size_t index = 0; !moved_on && index < handed_off_count; index += 1) {
      moved_on = strcmp(locator.session_id, handed_off[index]) == 0;
    }
    if (moved_on) continue;
    bool same_process = locator.host_pid == host_pid
      && locator.host_start_seconds == host_start_seconds
      && locator.host_start_microseconds == host_start_microseconds;
    held = !same_process && !pt_process_generation_ended(
      (pid_t)locator.host_pid,
      locator.host_start_seconds,
      locator.host_start_microseconds
    );
  }
  closedir(stream);
  return held;
}

static void remove_predecessors(
  const char *directory,
  const char *current_name,
  const char *plugin_root,
  pid_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds
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
        || strcmp(entry->d_name, current_name) == 0) {
      continue;
    }
    if (unlink(locator.path) != 0) {
      closedir(stream);
      fail("locator-predecessor-remove");
    }
  }
  closedir(stream);
}

/* A private file is published the one way: written under a temporary name of
   its own, flushed, checked, and only then renamed into place, so a reader
   sees the whole file or none of it. The temporary name is
   `<directory>/<prefix><uuid>.tmp`. Each caller names the failure of every
   step, because the files it publishes are told apart by their category. */
typedef struct {
  char temporary_path[PATH_MAX];
  int descriptor;
} PrivateFile;

typedef struct {
  const char *flush;
  const char *permissions;
  const char *publish;
} PrivateFileFailures;

static void name_private_file(
  PrivateFile *file,
  const char *directory,
  const char *prefix,
  const char *path_failure
) {
  char temporary_id[37];
  pt_random_uuid(temporary_id);
  int length = snprintf(
    file->temporary_path,
    sizeof(file->temporary_path),
    "%s/%s%s.tmp",
    directory,
    prefix,
    temporary_id
  );
  if (length < 0 || (size_t)length >= sizeof(file->temporary_path)) {
    fail(path_failure);
  }
  file->descriptor = -1;
}

static void create_private_file(PrivateFile *file, const char *create_failure) {
  file->descriptor = open(
    file->temporary_path,
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    0600
  );
  if (file->descriptor < 0) fail(create_failure);
}

/* Moves the written file to `final_path`. The caller checks the published file
   and flushes its directory, since the locator does more between the two. */
static void publish_private_file(
  PrivateFile *file,
  const char *final_path,
  PrivateFileFailures failures
) {
  if (fsync(file->descriptor) != 0 || close(file->descriptor) != 0) {
    unlink(file->temporary_path);
    fail(failures.flush);
  }
  if (!pt_path_is_private_file(file->temporary_path)) {
    unlink(file->temporary_path);
    fail(failures.permissions);
  }
  if (rename(file->temporary_path, final_path) != 0) {
    unlink(file->temporary_path);
    fail(failures.publish);
  }
}

static void flush_directory(const char *directory, const char *failure) {
  int descriptor = open(directory, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (descriptor < 0 || fsync(descriptor) != 0) {
    if (descriptor >= 0) close(descriptor);
    fail(failure);
  }
  close(descriptor);
}

/* Which Run each classic session belongs to, so a resume — in this process or
   a later one — finds the Run it continues. One private file per session under
   plugin data, holding identity only: never a prompt, never a path. It is
   written once, when a session is first seen, and read on every resume. A
   session the conversation continued in from another also names that source
   session, so each process it is opened in can take up the source's branch. */
#define SESSION_INDEX_VERSION 1

static void session_index_path(
  const char *plugin_data,
  const char *session_id,
  bool create_directory,
  char output[PATH_MAX]
) {
  char directory[PATH_MAX];
  int length = snprintf(directory, sizeof(directory), "%s/sessions", plugin_data);
  if (length < 0 || (size_t)length >= sizeof(directory)) fail("session-index-path");
  if (create_directory) ensure_directory(directory, true);
  length = snprintf(output, PATH_MAX, "%s/%s.json", directory, session_id);
  if (length < 0 || length >= PATH_MAX) fail("session-index-path");
}

typedef struct {
  char run_id[129];
  char archive_generation[129];
  /* Empty unless the session was continued in from another. */
  char continued_from[129];
} SessionIndex;

/* Answers whether the session is indexed. A record that exists but cannot be
   trusted fails closed rather than quietly starting a new Run, which would
   split the session's lineage without saying so. */
static bool read_session_index(
  const char *plugin_data,
  const char *session_id,
  SessionIndex *index
) {
  memset(index, 0, sizeof(*index));
  char path[PATH_MAX];
  session_index_path(plugin_data, session_id, false, path);
  struct stat status;
  if (lstat(path, &status) != 0) {
    if (errno == ENOENT) return false;
    fail("session-index-unavailable");
  }
  if (!pt_path_is_private_file(path)) fail("session-index-untrusted");

  char *record = NULL;
  char stored_session[129];
  int64_t version = 0;
  bool valid = pt_read_file(path, &record, NULL)
    && pt_json_validate(record)
    && pt_json_get_i64(record, "indexVersion", &version)
    && pt_json_get_string(record, "sessionId", stored_session, sizeof(stored_session))
    && pt_json_get_string(record, "runId", index->run_id, sizeof(index->run_id))
    && pt_json_get_string(
      record,
      "archiveGeneration",
      index->archive_generation,
      sizeof(index->archive_generation)
    )
    && version == SESSION_INDEX_VERSION
    && strcmp(stored_session, session_id) == 0
    && pt_is_safe_identifier(index->run_id)
    && pt_is_safe_identifier(index->archive_generation);
  /* The field is optional, but one that is present must hold a session:
     the record's other values are identifiers, so its quoted name appears
     only as a key. */
  if (valid && strstr(record, "\"continuedFrom\"") != NULL) {
    valid = pt_json_get_string(
        record,
        "continuedFrom",
        index->continued_from,
        sizeof(index->continued_from)
      )
      && pt_is_safe_identifier(index->continued_from)
      && strcmp(index->continued_from, session_id) != 0;
  }
  free(record);
  if (!valid) fail("session-index-invalid");
  return true;
}

static void write_session_index(
  const char *plugin_data,
  const char *session_id,
  const char *run_id,
  const char *archive_generation,
  const char *continued_from
) {
  char path[PATH_MAX];
  session_index_path(plugin_data, session_id, true, path);
  char directory[PATH_MAX];
  snprintf(directory, sizeof(directory), "%s", path);
  char *slash = strrchr(directory, '/');
  if (!slash) fail("session-index-path");
  *slash = '\0';
  char prefix[PATH_MAX];
  int length = snprintf(prefix, sizeof(prefix), "%s.", slash + 1);
  if (length < 0 || (size_t)length >= sizeof(prefix)) fail("session-index-path");

  PrivateFile file;
  name_private_file(&file, directory, prefix, "session-index-path");
  create_private_file(&file, "session-index-create");
  dprintf(file.descriptor, "{\"indexVersion\":%d,", SESSION_INDEX_VERSION);
  write_key_string(file.descriptor, "\"sessionId\":", session_id);
  write_key_string(file.descriptor, ",\"runId\":", run_id);
  write_key_string(file.descriptor, ",\"archiveGeneration\":", archive_generation);
  if (continued_from[0] != '\0') {
    write_key_string(file.descriptor, ",\"continuedFrom\":", continued_from);
  }
  write_literal(file.descriptor, "}\n");
  publish_private_file(
    &file,
    path,
    (PrivateFileFailures){
      .flush = "session-index-flush",
      .permissions = "session-index-publish",
      .publish = "session-index-publish"
    }
  );
  /* The entry itself has to survive a crash, or a later resume reads a session
     it has never seen and splits the lineage. */
  flush_directory(directory, "session-index-flush");
}

/* The sessions a conversation has been handed off from on its way to this
   one, nearest first, as far as the index records. A process still showing
   one of them no longer holds the conversation. */
#define HANDOFF_CHAIN_LIMIT 32

static size_t handed_off_chain(
  const char *plugin_data,
  const char *continued_from,
  char chain[HANDOFF_CHAIN_LIMIT][129]
) {
  size_t count = 0;
  char next[129];
  snprintf(next, sizeof(next), "%s", continued_from);
  while (next[0] != '\0' && count < HANDOFF_CHAIN_LIMIT) {
    snprintf(chain[count], 129, "%s", next);
    SessionIndex index;
    if (read_session_index(plugin_data, chain[count], &index)) {
      snprintf(next, sizeof(next), "%s", index.continued_from);
    } else {
      next[0] = '\0';
    }
    count += 1;
  }
  return count;
}

/* A conversation moved to a background session goes on in a new classic
   session, started as a fork of the old transcript. What ties the two is the
   `continued-in` record the host then appends to the old transcript, naming
   the new session; the new session's own start says nothing of where it came
   from. The record is looked for the way the host reads it: in the tail of
   the transcripts beside the new one, newest row first. The host appends it
   just before the new session starts, so only a transcript written in the
   last moments can hold it; the rest are not read at all. */
#define CONTINUATION_TAIL_BYTES (64 * 1024)
#define CONTINUATION_WINDOW_SECONDS 120

/* A turn after the record means the conversation went on in the source
   after all, so the record no longer says where it continues. */
typedef enum { ROW_OTHER, ROW_TURN, ROW_CONTINUES_HERE } TranscriptRow;

static TranscriptRow read_transcript_row(const char *row, const char *session_id) {
  char type[64];
  if (!pt_json_get_string(row, "type", type, sizeof(type))) return ROW_OTHER;
  if (strcmp(type, "user") == 0 || strcmp(type, "assistant") == 0) return ROW_TURN;
  char continued_in[129];
  return strcmp(type, "continued-in") == 0
      && pt_json_get_string(
        row,
        "continuedInSessionId",
        continued_in,
        sizeof(continued_in)
      )
      && strcmp(continued_in, session_id) == 0
    ? ROW_CONTINUES_HERE
    : ROW_OTHER;
}

static bool transcript_continues_in(
  const char *path,
  const char *session_id,
  time_t now
) {
  struct stat status;
  if (lstat(path, &status) != 0
      || !S_ISREG(status.st_mode)
      || status.st_mtime < now - CONTINUATION_WINDOW_SECONDS
      || status.st_mtime > now) {
    return false;
  }
  int descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor < 0) return false;
  if (fstat(descriptor, &status) != 0
      || !S_ISREG(status.st_mode)
      || status.st_uid != geteuid()) {
    close(descriptor);
    return false;
  }
  off_t start = status.st_size > CONTINUATION_TAIL_BYTES
    ? status.st_size - CONTINUATION_TAIL_BYTES
    : 0;
  size_t wanted = (size_t)(status.st_size - start);
  char *tail = malloc(wanted + 1);
  if (!tail) {
    close(descriptor);
    return false;
  }
  ssize_t length = pread(descriptor, tail, wanted, start);
  close(descriptor);
  if (length < 0) {
    free(tail);
    return false;
  }
  tail[length] = '\0';

  TranscriptRow found = ROW_OTHER;
  char *end = tail + length;
  while (found == ROW_OTHER && end > tail) {
    *end = '\0';
    char *row = end;
    while (row > tail && row[-1] != '\n') row -= 1;
    /* A row cut by the start of the tail is not a row. */
    if (row == tail && start > 0) break;
    found = read_transcript_row(row, session_id);
    end = row > tail ? row - 1 : tail;
  }
  free(tail);
  return found == ROW_CONTINUES_HERE;
}

/* Answers the one session whose transcript says the conversation continued
   in this one. None, or more than one, is no continuation: the session then
   begins a Run of its own rather than guessing whose it takes up. */
static bool find_continued_source(
  const char *transcript_path,
  const char *session_id,
  char source[129]
) {
  source[0] = '\0';
  if (transcript_path[0] != '/') return false;
  char directory[PATH_MAX];
  int length = snprintf(directory, sizeof(directory), "%s", transcript_path);
  if (length < 0 || (size_t)length >= sizeof(directory)) return false;
  char *slash = strrchr(directory, '/');
  *(slash == directory ? slash + 1 : slash) = '\0';

  DIR *stream = opendir(directory);
  if (!stream) return false;
  time_t now = time(NULL);
  unsigned matches = 0;
  struct dirent *entry = NULL;
  while ((entry = readdir(stream)) != NULL) {
    size_t name_length = strlen(entry->d_name);
    if (name_length <= 6
        || strcmp(entry->d_name + name_length - 6, ".jsonl") != 0
        || name_length - 6 >= 129) {
      continue;
    }
    char candidate[129];
    memcpy(candidate, entry->d_name, name_length - 6);
    candidate[name_length - 6] = '\0';
    if (!pt_is_safe_identifier(candidate) || strcmp(candidate, session_id) == 0) {
      continue;
    }
    char path[PATH_MAX];
    length = snprintf(path, sizeof(path), "%s/%s", directory, entry->d_name);
    if (length < 0 || (size_t)length >= sizeof(path)) continue;
    if (transcript_continues_in(path, session_id, now)) {
      matches += 1;
      snprintf(source, 129, "%s", candidate);
      /* Two sources already make it no continuation. */
      if (matches > 1) break;
    }
  }
  closedir(stream);
  if (matches != 1) source[0] = '\0';
  return matches == 1;
}

/* Deciding a session's Run and publishing the locator that claims it is one
   step, taken by one bridge at a time. Without it two processes resuming the
   same session could both find its Run unheld and both take it up, or both
   find the session unindexed and index it to two different Runs. The lock is
   released when the bridge exits, however it exits. */
static void lock_publication(const char *directory) {
  char path[PATH_MAX];
  int length = snprintf(path, sizeof(path), "%s/.publish.lock", directory);
  if (length < 0 || (size_t)length >= sizeof(path)) fail("locator-path");
  int descriptor = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (descriptor < 0) fail("locator-lock");
  struct stat status;
  if (fstat(descriptor, &status) != 0
      || !S_ISREG(status.st_mode)
      || status.st_uid != geteuid()
      || (status.st_mode & 0077) != 0) {
    fail("locator-lock");
  }
  while (flock(descriptor, LOCK_EX) != 0) {
    if (errno != EINTR) fail("locator-lock");
  }
}

static void publish_locator(
  const char *session_id,
  const char *source,
  const char *transcript_path,
  const char *plugin_root,
  const char *plugin_data,
  const char *helper_path,
  const char *manifest_path
) {
  char directory[PATH_MAX];
  locator_directory(directory);
  lock_publication(directory);
  remove_proven_stale_locators(directory);

  PrivateFile file;
  name_private_file(&file, directory, ".", "locator-path");

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

  char locator_name[PATH_MAX];
  char locator_path[PATH_MAX];
  if (!pt_locator_file_name(
        session_id,
        host_pid,
        host_start_seconds,
        host_start_microseconds,
        locator_name,
        sizeof(locator_name)
      )) {
    fail("locator-path");
  }
  int length = snprintf(locator_path, sizeof(locator_path), "%s/%s", directory, locator_name);
  if (length < 0 || (size_t)length >= sizeof(locator_path)) fail("locator-path");

  /* A Run is the lineage of one conversation, not one process. A `/clear`
     changes the classic session inside the same process, so it inherits the
     identity a locator of this very generation already holds; a `/clear`
     without one fails closed rather than inventing a Run. A resume — an
     in-process `/resume`, `--resume` or `--continue` — continues whichever Run
     the session index says the session belongs to, and a session it has never
     seen begins a new one. `startup` and `fork` begin a new Run: nothing
     inherited from a parent's environment stands in for a lineage. The one
     exception is a fork the conversation itself moved into, which its source
     transcript records; that session goes on in the source's Run. */
  SessionIndex index;
  bool indexed = read_session_index(plugin_data, session_id, &index);
  bool continues = false;
  if (strcmp(source, "clear") == 0) {
    if (!load_predecessor_identity(
          directory,
          plugin_root,
          host_pid,
          host_start_seconds,
          host_start_microseconds,
          index.run_id,
          index.archive_generation
        )) {
      fail("locator-predecessor-missing");
    }
    continues = true;
  } else if (strcmp(source, "resume") == 0 && indexed) {
    char chain[HANDOFF_CHAIN_LIMIT][129];
    size_t chain_length = handed_off_chain(plugin_data, index.continued_from, chain);
    continues = !run_held_elsewhere(
      directory,
      index.run_id,
      (const char (*)[129])chain,
      chain_length,
      host_pid,
      host_start_seconds,
      host_start_microseconds
    );
  } else if (strcmp(source, "fork") == 0 && !indexed) {
    char handed_from[129];
    SessionIndex handed_from_index;
    if (find_continued_source(transcript_path, session_id, handed_from)
        && read_session_index(plugin_data, handed_from, &handed_from_index)) {
      char chain[HANDOFF_CHAIN_LIMIT][129];
      size_t chain_length = handed_off_chain(plugin_data, handed_from, chain);
      continues = !run_held_elsewhere(
        directory,
        handed_from_index.run_id,
        (const char (*)[129])chain,
        chain_length,
        host_pid,
        host_start_seconds,
        host_start_microseconds
      );
      if (continues) {
        snprintf(index.run_id, sizeof(index.run_id), "%s", handed_from_index.run_id);
        snprintf(
          index.archive_generation,
          sizeof(index.archive_generation),
          "%s",
          handed_from_index.archive_generation
        );
        snprintf(index.continued_from, sizeof(index.continued_from), "%s", handed_from);
      }
    }
  }
  /* `archiveGeneration` in the locator and the session index is a token
     minted with each new Run and never checked. It is not the Archive
     generation: that is the archive file itself, which the helper names and
     checks, and which this bridge cannot see without knowing the project. */
  if (!continues) {
    pt_random_uuid(index.run_id);
    pt_random_uuid(index.archive_generation);
    index.continued_from[0] = '\0';
  }
  if (!indexed) {
    write_session_index(
      plugin_data,
      session_id,
      index.run_id,
      index.archive_generation,
      index.continued_from
    );
  }

  char database_root[PATH_MAX];
  length = snprintf(database_root, sizeof(database_root), "%s/archives", plugin_data);
  if (length < 0 || (size_t)length >= sizeof(database_root)) fail("database-root");

  const char *status = artifact_status(helper_path, manifest_path);
  mode_t previous_umask = umask(0077);
  create_private_file(&file, "locator-create");
  int descriptor = file.descriptor;

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
  write_key_string(descriptor, ",\"runId\":", index.run_id);
  write_key_string(
    descriptor,
    ",\"archiveGeneration\":",
    index.archive_generation
  );
  if (index.continued_from[0] != '\0') {
    write_key_string(descriptor, ",\"continuedFrom\":", index.continued_from);
  }
  write_literal(descriptor, "}\n");

  publish_private_file(
    &file,
    locator_path,
    (PrivateFileFailures){
      .flush = "locator-flush",
      .permissions = "locator-permissions",
      .publish = "locator-publish"
    }
  );
  if (!pt_path_is_private_file(locator_path)) {
    unlink(locator_path);
    fail("locator-permissions");
  }
  /* One process has one classic session open at a time: whatever this
     process published for the session it just left — the same Run after a
     `/clear`, possibly another after an in-process `/resume` — is done.
     `startup` and `fork` open a process's first session: there is nothing of
     its own to retire. */
  if (strcmp(source, "clear") == 0 || strcmp(source, "resume") == 0) {
    remove_predecessors(
      directory,
      locator_name,
      plugin_root,
      host_pid,
      host_start_seconds,
      host_start_microseconds
    );
  }
  flush_directory(directory, "locator-directory-flush");
  umask(previous_umask);
}

static void remove_locator(
  const char *session_id,
  const char *expected_plugin_root
) {
  char directory[PATH_MAX];
  locator_directory(directory);
  /* Only this process's own locator for the session: another process that
     resumed the same session keeps its locator. */
  pid_t own_pid = getppid();
  char own_executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t own_start_seconds = 0;
  int64_t own_start_microseconds = 0;
  if (!pt_process_identity(
        own_pid,
        own_executable,
        sizeof(own_executable),
        &own_start_seconds,
        &own_start_microseconds
      )) {
    fail("host-generation-unproven");
  }
  char locator_name[PATH_MAX];
  char locator_path[PATH_MAX];
  if (!pt_locator_file_name(
        session_id,
        own_pid,
        own_start_seconds,
        own_start_microseconds,
        locator_name,
        sizeof(locator_name)
      )) {
    fail("locator-path");
  }
  int length = snprintf(locator_path, sizeof(locator_path), "%s/%s", directory, locator_name);
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
    /* Only where a continuation is looked for; any other start may omit it. */
    char transcript_path[PATH_MAX];
    if (!pt_json_get_string(
          input,
          "transcript_path",
          transcript_path,
          sizeof(transcript_path)
        )) {
      transcript_path[0] = '\0';
    }
    publish_locator(
      session_id,
      source,
      transcript_path,
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

#define _DARWIN_C_SOURCE

#include "prompt_trail_common.h"

#define PT_HELPER_PROTOCOL 1

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <libproc.h>
#include <mach-o/dyld.h>
#include <sqlite3.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/utsname.h>
#include <unistd.h>

#define MINIMUM_CLAUDE_VERSION_MAJOR 2UL
#define MINIMUM_CLAUDE_VERSION_MINOR 1UL
#define MINIMUM_CLAUDE_VERSION_PATCH 273UL
#define EXIT_UNSUPPORTED 10
#define EXIT_HELPER_UNAVAILABLE 20
#define EXIT_LOCATOR_INVALID 21
#define EXIT_ARTIFACT_MISMATCH 22
#define EXIT_PROTOCOL_MISMATCH 23
#define EXIT_SQLITE_CAPABILITY 24
#define EXIT_ARCHIVE_UNAVAILABLE 25

/* Non-prompt Timeline Events. They share the project-level monotonic sequence
   with prompt entries, so a boundary is ordered against prompts by sequence
   alone and never carries prompt text. */
#define TIMELINE_EVENTS_DDL \
  "CREATE TABLE timeline_events(" \
  " event_id TEXT PRIMARY KEY," \
  " sequence INTEGER NOT NULL UNIQUE," \
  " kind TEXT NOT NULL," \
  " run_id TEXT NOT NULL," \
  " segment_id TEXT NOT NULL," \
  " branch_id TEXT NOT NULL," \
  " occurred_at_ms INTEGER NOT NULL" \
  ");" \
  "CREATE INDEX timeline_events_run_sequence " \
  "ON timeline_events(run_id, sequence);"

static void json_error(int status, const char *category) {
  fprintf(stderr, "{\"category\":\"%s\"}\n", category);
  exit(status);
}

static bool parse_release_version(
  const char *text,
  unsigned long components[3]
) {
  const char *cursor = text;
  for (size_t index = 0; index < 3; index += 1) {
    if (!isdigit((unsigned char)*cursor)) return false;
    errno = 0;
    char *end = NULL;
    components[index] = strtoul(cursor, &end, 10);
    if (errno != 0 || end == cursor) return false;
    if (index < 2) {
      if (*end != '.') return false;
      cursor = end + 1;
    } else {
      return *end == '\0';
    }
  }
  return false;
}

static bool claude_version_supported(const char *text) {
  unsigned long version[3];
  if (!parse_release_version(text, version)) return false;
  const unsigned long minimum[3] = {
    MINIMUM_CLAUDE_VERSION_MAJOR,
    MINIMUM_CLAUDE_VERSION_MINOR,
    MINIMUM_CLAUDE_VERSION_PATCH,
  };
  for (size_t index = 0; index < 3; index += 1) {
    if (version[index] != minimum[index]) {
      return version[index] > minimum[index];
    }
  }
  return true;
}

static bool sqlite_supports_returning(void) {
  sqlite3 *database = NULL;
  sqlite3_stmt *statement = NULL;
  bool supported = false;

  if (sqlite3_open_v2(
        ":memory:",
        &database,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
        NULL
      ) != SQLITE_OK) {
    goto done;
  }
  if (sqlite3_exec(
        database,
        "CREATE TABLE capability(value INTEGER NOT NULL);"
        "INSERT INTO capability VALUES(1);",
        NULL,
        NULL,
        NULL
      ) != SQLITE_OK) {
    goto done;
  }
  if (sqlite3_prepare_v2(
        database,
        "UPDATE capability SET value=value+1 RETURNING value",
        -1,
        &statement,
        NULL
      ) != SQLITE_OK) {
    goto done;
  }
  supported = sqlite3_step(statement) == SQLITE_ROW
    && sqlite3_column_int(statement, 0) == 2;

done:
  sqlite3_finalize(statement);
  sqlite3_close(database);
  return supported;
}

static void product_version(char output[64]) {
  size_t size = 64;
  if (sysctlbyname("kern.osproductversion", output, &size, NULL, 0) != 0
      || size == 0
      || size >= 64) {
    json_error(EXIT_UNSUPPORTED, "macos-version-unproven");
  }
  output[size] = '\0';
}

static void target_capabilities(
  char macos_version[64],
  int *sqlite_version
) {
  struct utsname identity;
  if (uname(&identity) != 0) {
    json_error(EXIT_UNSUPPORTED, "operating-system-unproven");
  }
  if (strcmp(identity.sysname, "Darwin") != 0) {
    json_error(EXIT_UNSUPPORTED, "operating-system");
  }
  if (strcmp(identity.machine, "arm64") != 0) {
    json_error(EXIT_UNSUPPORTED, "architecture");
  }

  product_version(macos_version);
  char *version_end = NULL;
  long major = strtol(macos_version, &version_end, 10);
  if (version_end == macos_version || major != 15) {
    json_error(EXIT_UNSUPPORTED, "macos-major-version");
  }

  *sqlite_version = sqlite3_libversion_number();
  if (*sqlite_version < 3035000 || !sqlite_supports_returning()) {
    json_error(EXIT_SQLITE_CAPABILITY, "sqlite-capability");
  }
}

static long parse_protocol(const char *text) {
  char *end = NULL;
  errno = 0;
  long protocol = strtol(text, &end, 10);
  if (errno != 0 || !end || *end != '\0' || protocol != PT_HELPER_PROTOCOL) {
    json_error(EXIT_PROTOCOL_MISMATCH, "protocol-mismatch");
  }
  return protocol;
}

static void probe(const char *protocol_text) {
  (void)parse_protocol(protocol_text);
  char macos_version[64];
  int sqlite_version = 0;
  target_capabilities(macos_version, &sqlite_version);

  printf(
    "{\"status\":\"supported\",\"helperProtocol\":%d,"
    "\"target\":\"darwin-arm64-macos15\","
    "\"macosVersion\":\"%s\",\"sqliteVersionNumber\":%d,"
    "\"sqliteReturning\":true}\n",
    PT_HELPER_PROTOCOL,
    macos_version,
    sqlite_version
  );
}

static void self_path(char output[PATH_MAX]) {
  uint32_t capacity = PATH_MAX;
  char unresolved[PATH_MAX];
  if (_NSGetExecutablePath(unresolved, &capacity) != 0
      || !realpath(unresolved, output)) {
    json_error(EXIT_HELPER_UNAVAILABLE, "helper-path-unproven");
  }
}

static void require_regular_owned_file(
  const char *path,
  bool executable,
  const char *category
) {
  struct stat status;
  if (lstat(path, &status) != 0
      || !S_ISREG(status.st_mode)
      || status.st_uid != geteuid()
      || (status.st_mode & 0022) != 0
      || pt_has_write_grant_acl(path)
      || (executable && access(path, X_OK) != 0)) {
    json_error(EXIT_ARTIFACT_MISMATCH, category);
  }
}

static void require_manifest(
  const char *manifest_path,
  const char *expected_sha
) {
  require_regular_owned_file(manifest_path, false, "manifest-untrusted");
  char *manifest = NULL;
  char manifest_target[64];
  char manifest_file[PATH_MAX];
  char manifest_sha[65];
  int64_t format = 0;
  int64_t protocol = 0;
  int64_t sqlite_minimum = 0;
  if (!pt_read_file(manifest_path, &manifest, NULL)
      || !pt_json_validate(manifest)
      || !pt_json_get_i64(manifest, "formatVersion", &format)
      || !pt_json_get_i64(manifest, "helperProtocol", &protocol)
      || !pt_json_get_i64(
        manifest,
        "sqliteMinimumVersionNumber",
        &sqlite_minimum
      )
      || !pt_json_get_string(
        manifest,
        "target",
        manifest_target,
        sizeof(manifest_target)
      )
      || !pt_json_get_string(
        manifest,
        "file",
        manifest_file,
        sizeof(manifest_file)
      )
      || !pt_json_get_string(
        manifest,
        "sha256",
        manifest_sha,
        sizeof(manifest_sha)
      )
      || format != 1
      || protocol != PT_HELPER_PROTOCOL
      || sqlite_minimum != 3035000
      || strcmp(manifest_target, "darwin-arm64-macos15") != 0
      || strcmp(manifest_file, "bin/prompt-trail-helper") != 0
      || strcmp(manifest_sha, expected_sha) != 0) {
    free(manifest);
    json_error(EXIT_ARTIFACT_MISMATCH, "manifest-invalid");
  }
  free(manifest);
}

/* The one locator this helper may read: the bridge names each after the
   session and the host process generation that published it, so a locator
   another process published for the same session is never mistaken for this
   one. The helper's own parent is that host process. */
static void expected_locator_path(
  const char *session_id,
  char output[PATH_MAX]
) {
  const char *home = getenv("HOME");
  if (!home || home[0] != '/') {
    json_error(EXIT_LOCATOR_INVALID, "home-unavailable");
  }
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
    json_error(EXIT_LOCATOR_INVALID, "host-generation");
  }
  char name[PATH_MAX];
  if (!pt_locator_file_name(
        session_id,
        host_pid,
        host_start_seconds,
        host_start_microseconds,
        name,
        sizeof(name)
      )) {
    json_error(EXIT_LOCATOR_INVALID, "locator-path");
  }
  int length = snprintf(
    output,
    PATH_MAX,
    "%s/.claude/plugins/data/.function-hook-locators/prompt-trail/%s",
    home,
    name
  );
  if (length < 0 || length >= PATH_MAX) {
    json_error(EXIT_LOCATOR_INVALID, "locator-path");
  }
}

static void require_path_layout(
  const char *plugin_root,
  const char *plugin_data,
  const char *database_root,
  const char *helper_path,
  const char *manifest_path
) {
  char expected[PATH_MAX];
  int length = snprintf(
    expected,
    sizeof(expected),
    "%s/bin/prompt-trail-helper",
    plugin_root
  );
  if (length < 0 || (size_t)length >= sizeof(expected)
      || strcmp(expected, helper_path) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "helper-path");
  }
  length = snprintf(
    expected,
    sizeof(expected),
    "%s/artifacts/helper-manifest.json",
    plugin_root
  );
  if (length < 0 || (size_t)length >= sizeof(expected)
      || strcmp(expected, manifest_path) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "manifest-path");
  }
  length = snprintf(expected, sizeof(expected), "%s/archives", plugin_data);
  if (length < 0 || (size_t)length >= sizeof(expected)
      || strcmp(expected, database_root) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "database-root");
  }

  struct stat plugin_data_status;
  if (lstat(plugin_data, &plugin_data_status) != 0
      || !S_ISDIR(plugin_data_status.st_mode)
      || plugin_data_status.st_uid != geteuid()
      || (plugin_data_status.st_mode & 0777) != 0700
      || pt_has_extended_acl(plugin_data)) {
    json_error(EXIT_ARTIFACT_MISMATCH, "plugin-data-permissions");
  }

  struct stat database_status;
  if (lstat(database_root, &database_status) == 0) {
    if (!S_ISDIR(database_status.st_mode)
        || database_status.st_uid != geteuid()
        || (database_status.st_mode & 0777) != 0700
        || pt_has_extended_acl(database_root)) {
      json_error(EXIT_ARTIFACT_MISMATCH, "database-root-permissions");
    }
  } else if (errno != ENOENT) {
    json_error(EXIT_ARTIFACT_MISMATCH, "database-root-unavailable");
  }
}

static void write_status_string(const char *prefix, const char *value) {
  fputs(prefix, stdout);
  fflush(stdout);
  pt_write_json_string(STDOUT_FILENO, value);
}

static void preflight(
  const char *locator_path,
  const char *session_id,
  const char *expected_sha,
  const char *protocol_text
) {
  (void)parse_protocol(protocol_text);
  if (!pt_is_safe_identifier(session_id)) {
    json_error(EXIT_LOCATOR_INVALID, "locator-session");
  }
  if (strlen(expected_sha) != 64) {
    json_error(EXIT_ARTIFACT_MISMATCH, "expected-digest-invalid");
  }

  char expected_path[PATH_MAX];
  expected_locator_path(session_id, expected_path);
  if (strcmp(expected_path, locator_path) != 0) {
    json_error(EXIT_LOCATOR_INVALID, "locator-path");
  }
  if (!pt_path_is_private_file(locator_path)) {
    json_error(EXIT_LOCATOR_INVALID, "locator-permissions");
  }

  char parent[PATH_MAX];
  memcpy(parent, locator_path, strlen(locator_path) + 1);
  char *slash = strrchr(parent, '/');
  if (!slash) json_error(EXIT_LOCATOR_INVALID, "locator-path");
  *slash = '\0';
  if (!pt_path_is_private_directory(parent)) {
    json_error(EXIT_LOCATOR_INVALID, "locator-directory-permissions");
  }

  char *locator = NULL;
  int64_t locator_version = 0;
  int64_t plugin_protocol = 0;
  int64_t helper_protocol = 0;
  int64_t host_pid = 0;
  int64_t host_start_seconds = 0;
  int64_t host_start_microseconds = 0;
  char stored_session[129];
  char host_executable[PROC_PIDPATHINFO_MAXSIZE];
  char host_version[64];
  char plugin_root[PATH_MAX];
  char plugin_data[PATH_MAX];
  char database_root[PATH_MAX];
  char helper_path[PATH_MAX];
  char manifest_path[PATH_MAX];
  char helper_sha[65];
  char artifact_status[64];
  char run_id[129];
  char archive_generation[129];

  if (!pt_read_file(locator_path, &locator, NULL)
      || !pt_json_validate(locator)
      || !pt_json_get_i64(locator, "locatorVersion", &locator_version)
      || !pt_json_get_i64(locator, "pluginProtocol", &plugin_protocol)
      || !pt_json_get_i64(locator, "helperProtocol", &helper_protocol)
      || !pt_json_get_i64(locator, "hostPid", &host_pid)
      || !pt_json_get_i64(locator, "hostStartSeconds", &host_start_seconds)
      || !pt_json_get_i64(
        locator,
        "hostStartMicroseconds",
        &host_start_microseconds
      )
      || !pt_json_get_string(
        locator,
        "sessionId",
        stored_session,
        sizeof(stored_session)
      )
      || !pt_json_get_string(
        locator,
        "hostExecutable",
        host_executable,
        sizeof(host_executable)
      )
      || !pt_json_get_string(
        locator,
        "hostVersion",
        host_version,
        sizeof(host_version)
      )
      || !pt_json_get_string(locator, "pluginRoot", plugin_root, sizeof(plugin_root))
      || !pt_json_get_string(locator, "pluginData", plugin_data, sizeof(plugin_data))
      || !pt_json_get_string(
        locator,
        "databaseRoot",
        database_root,
        sizeof(database_root)
      )
      || !pt_json_get_string(locator, "helperPath", helper_path, sizeof(helper_path))
      || !pt_json_get_string(
        locator,
        "manifestPath",
        manifest_path,
        sizeof(manifest_path)
      )
      || !pt_json_get_string(
        locator,
        "helperSha256",
        helper_sha,
        sizeof(helper_sha)
      )
      || !pt_json_get_string(
        locator,
        "artifactStatus",
        artifact_status,
        sizeof(artifact_status)
      )
      || !pt_json_get_string(locator, "runId", run_id, sizeof(run_id))
      || !pt_json_get_string(
        locator,
        "archiveGeneration",
        archive_generation,
        sizeof(archive_generation)
      )) {
    free(locator);
    json_error(EXIT_LOCATOR_INVALID, "locator-schema");
  }
  free(locator);

  if (locator_version != 1 || plugin_protocol != 1) {
    json_error(EXIT_LOCATOR_INVALID, "locator-schema");
  }
  if (helper_protocol != PT_HELPER_PROTOCOL) {
    json_error(EXIT_PROTOCOL_MISMATCH, "locator-protocol-mismatch");
  }
  if (strcmp(stored_session, session_id) != 0) {
    json_error(EXIT_LOCATOR_INVALID, "locator-session");
  }
  if (!pt_is_safe_identifier(run_id) || !pt_is_safe_identifier(archive_generation)) {
    json_error(EXIT_LOCATOR_INVALID, "locator-identifiers");
  }
  if (host_pid != getppid()
      || !pt_process_is_same(
        (pid_t)host_pid,
        host_start_seconds,
        host_start_microseconds
      )) {
    json_error(EXIT_LOCATOR_INVALID, "host-generation");
  }
  char actual_host_executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t ignored_seconds = 0;
  int64_t ignored_microseconds = 0;
  if (!pt_process_identity(
        (pid_t)host_pid,
        actual_host_executable,
        sizeof(actual_host_executable),
        &ignored_seconds,
        &ignored_microseconds
      )
      || strcmp(actual_host_executable, host_executable) != 0) {
    json_error(EXIT_LOCATOR_INVALID, "host-executable");
  }
  unsigned long host_version_components[3];
  if (!parse_release_version(host_version, host_version_components)) {
    json_error(EXIT_UNSUPPORTED, "claude-code-version-unproven");
  }
  if (!claude_version_supported(host_version)) {
    json_error(EXIT_UNSUPPORTED, "claude-code-version");
  }
  if (strcmp(artifact_status, "trusted") != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, artifact_status);
  }
  if (strcmp(helper_sha, expected_sha) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "locator-digest-mismatch");
  }

  require_path_layout(
    plugin_root,
    plugin_data,
    database_root,
    helper_path,
    manifest_path
  );
  require_regular_owned_file(helper_path, true, "helper-untrusted");
  char actual_self[PATH_MAX];
  self_path(actual_self);
  if (strcmp(actual_self, helper_path) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "helper-path-mismatch");
  }
  char actual_sha[65];
  if (!pt_sha256_file(helper_path, actual_sha)
      || strcmp(actual_sha, expected_sha) != 0) {
    json_error(EXIT_ARTIFACT_MISMATCH, "digest-mismatch");
  }
  require_manifest(manifest_path, expected_sha);

  char macos_version[64];
  int sqlite_version = 0;
  target_capabilities(macos_version, &sqlite_version);

  fputs(
    "{\"status\":\"supported\",\"artifactStatus\":\"trusted\",",
    stdout
  );
  write_status_string("\"sessionId\":", session_id);
  write_status_string(",\"runId\":", run_id);
  write_status_string(",\"archiveGeneration\":", archive_generation);
  write_status_string(",\"databaseRoot\":", database_root);
  write_status_string(",\"helperPath\":", helper_path);
  printf(
    ",\"helperProtocol\":%d,\"macosVersion\":\"%s\","
    "\"sqliteVersionNumber\":%d,\"sqliteReturning\":true}\n",
    PT_HELPER_PROTOCOL,
    macos_version,
    sqlite_version
  );
}

static void usage(void);

static void archive_error(const char *category) {
  json_error(EXIT_ARCHIVE_UNAVAILABLE, category);
}

static bool lowercase_sha256(const char *value) {
  if (strlen(value) != 64) return false;
  for (size_t index = 0; index < 64; index += 1) {
    if (!isdigit((unsigned char)value[index])
        && !(value[index] >= 'a' && value[index] <= 'f')) {
      return false;
    }
  }
  return true;
}

static long long nonnegative_integer(const char *value) {
  char *end = NULL;
  errno = 0;
  long long parsed = strtoll(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed < 0) {
    archive_error("capture-input");
  }
  return parsed;
}

static bool valid_prompt_text(const char *text, size_t length) {
  size_t index = 0;
  while (index < length) {
    unsigned char byte = (unsigned char)text[index];
    size_t extra = 0;
    unsigned long codepoint = 0;
    if (byte == 0x00) return false;
    if (byte < 0x80) {
      index += 1;
      continue;
    }
    if ((byte & 0xe0u) == 0xc0u) {
      extra = 1;
      codepoint = byte & 0x1fu;
    } else if ((byte & 0xf0u) == 0xe0u) {
      extra = 2;
      codepoint = byte & 0x0fu;
    } else if ((byte & 0xf8u) == 0xf0u) {
      extra = 3;
      codepoint = byte & 0x07u;
    } else {
      return false;
    }
    if (index + extra >= length) return false;
    for (size_t offset = 1; offset <= extra; offset += 1) {
      unsigned char continuation = (unsigned char)text[index + offset];
      if ((continuation & 0xc0u) != 0x80u) return false;
      codepoint = (codepoint << 6) | (continuation & 0x3fu);
    }
    if ((extra == 1 && codepoint < 0x80)
        || (extra == 2 && codepoint < 0x800)
        || (extra == 3 && codepoint < 0x10000)
        || codepoint > 0x10ffff
        || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
      return false;
    }
    index += extra + 1;
  }
  return true;
}

static char *read_prompt_text(size_t *length) {
  char *prompt = NULL;
  if (!pt_read_fd(STDIN_FILENO, &prompt, length)) {
    archive_error("capture-input");
  }
  if (!valid_prompt_text(prompt, *length)) {
    free(prompt);
    archive_error("capture-input");
  }
  return prompt;
}

static bool attachment_kinds_valid(const char *value) {
  if (strcmp(value, "-") == 0) return true;
  if (*value == '\0') return false;
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor;
       cursor += 1) {
    if (!islower(*cursor) && *cursor != ',') return false;
  }
  return true;
}

static void archive_sql(sqlite3 *database, const char *sql) {
  if (sqlite3_exec(database, sql, NULL, NULL, NULL) != SQLITE_OK) {
    archive_error("archive-sqlite");
  }
}

static sqlite3_stmt *archive_prepare(sqlite3 *database, const char *sql) {
  sqlite3_stmt *statement = NULL;
  if (sqlite3_prepare_v2(database, sql, -1, &statement, NULL) != SQLITE_OK) {
    archive_error("archive-sqlite");
  }
  return statement;
}

static void archive_bind_text(
  sqlite3 *database,
  sqlite3_stmt *statement,
  int index,
  const char *value
) {
  int result = value
    ? sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
    : sqlite3_bind_null(statement, index);
  if (result != SQLITE_OK) archive_error("archive-sqlite");
  (void)database;
}

static void archive_bind_prompt(
  sqlite3_stmt *statement,
  int index,
  const char *value,
  size_t length
) {
  if (sqlite3_bind_text64(
        statement,
        index,
        value,
        (sqlite3_uint64)length,
        SQLITE_TRANSIENT,
        SQLITE_UTF8
      ) != SQLITE_OK) {
    archive_error("archive-sqlite");
  }
}

/* What a subcommand needs of the archive root. A write either creates it
   (PT_ROOT_CREATE) or requires it (PT_ROOT_REQUIRE); a read that asks whether
   anything is unresolved treats an absent root as "nothing archived yet"
   (PT_ROOT_OPTIONAL) rather than as a failure. */
typedef enum {
  PT_ROOT_REQUIRE,
  PT_ROOT_CREATE,
  PT_ROOT_OPTIONAL,
} pt_root_mode;

static bool capture_runtime(
  const char *database_root,
  const char *expected_sha,
  const char *protocol_text,
  pt_root_mode root_mode
) {
  (void)parse_protocol(protocol_text);
  if (!lowercase_sha256(expected_sha)) {
    archive_error("expected-digest-invalid");
  }

  char actual_self[PATH_MAX];
  self_path(actual_self);
  char actual_sha[65];
  if (!pt_sha256_file(actual_self, actual_sha)
      || strcmp(actual_sha, expected_sha) != 0) {
    archive_error("digest-mismatch");
  }

  if (!database_root || database_root[0] != '/') {
    archive_error("database-root");
  }
  char parent[PATH_MAX];
  size_t root_length = strlen(database_root);
  if (root_length >= sizeof(parent)) archive_error("database-root");
  memcpy(parent, database_root, root_length + 1);
  char *slash = strrchr(parent, '/');
  if (!slash || strcmp(slash + 1, "archives") != 0) {
    archive_error("database-root");
  }
  *slash = '\0';
  char canonical_parent[PATH_MAX];
  if (!realpath(parent, canonical_parent)
      || strcmp(parent, canonical_parent) != 0
      || !pt_path_is_private_directory(parent)) {
    archive_error("plugin-data-permissions");
  }

  if (root_mode == PT_ROOT_CREATE) {
    if (!pt_ensure_private_directory(database_root)) {
      archive_error("database-root-permissions");
    }
  } else if (!pt_path_is_private_directory(database_root)) {
    /* Only a root that provably is not there answers "nothing archived yet".
       One that exists but fails ownership, type or permission checks is an
       archive this helper must not speak for, so it fails closed even for a
       read. */
    struct stat root_status;
    if (root_mode == PT_ROOT_OPTIONAL
        && lstat(database_root, &root_status) != 0
        && errno == ENOENT) {
      return false;
    }
    archive_error("database-root-unavailable");
  }
  char canonical_root[PATH_MAX];
  if (!realpath(database_root, canonical_root)
      || strcmp(database_root, canonical_root) != 0) {
    archive_error("database-root-permissions");
  }
  return true;
}

static int archive_schema_version(sqlite3 *database) {
  sqlite3_stmt *version = archive_prepare(database, "PRAGMA user_version");
  int schema_version = sqlite3_step(version) == SQLITE_ROW
    ? sqlite3_column_int(version, 0)
    : -1;
  sqlite3_finalize(version);
  return schema_version;
}

static sqlite3 *open_archive(
  const char *database_root,
  const char *project_id,
  bool create
) {
  if (!lowercase_sha256(project_id)) archive_error("project-identity");
  char database_path[PATH_MAX];
  int length = snprintf(
    database_path,
    sizeof(database_path),
    "%s/%s.sqlite3",
    database_root,
    project_id
  );
  if (length < 0 || (size_t)length >= sizeof(database_path)) {
    archive_error("database-path");
  }

  struct stat status;
  bool existed = lstat(database_path, &status) == 0;
  if (existed && !pt_path_is_private_file(database_path)) {
    archive_error("database-permissions");
  }
  if (!existed && errno != ENOENT) archive_error("database-unavailable");
  if (!create && !existed) archive_error("database-unavailable");

  sqlite3 *database = NULL;
  int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX;
  if (create) flags |= SQLITE_OPEN_CREATE;
  if (sqlite3_open_v2(database_path, &database, flags, NULL) != SQLITE_OK) {
    sqlite3_close(database);
    archive_error("database-unavailable");
  }
  if (!pt_path_is_private_file(database_path)) {
    sqlite3_close(database);
    archive_error("database-permissions");
  }
  sqlite3_busy_timeout(database, 10000);
  archive_sql(database, "PRAGMA journal_mode=WAL");
  archive_sql(database, "PRAGMA synchronous=FULL");
  archive_sql(database, "PRAGMA foreign_keys=ON");
  archive_sql(database, "PRAGMA secure_delete=ON");
  /* Sorts, indexes and `branch-match`'s transcript rows never spill prompt
     text into SQLite temporary files outside the private archive. */
  archive_sql(database, "PRAGMA temp_store=MEMORY");

  /* An already-current archive needs no write lock. Anything older takes one
     and re-reads the version under it, so two Runs opening the same schema-1
     archive cannot both replay the migration onto an upgraded file. */
  if (archive_schema_version(database) != 2) {
    archive_sql(database, "BEGIN IMMEDIATE");
    int schema_version = archive_schema_version(database);
    if (schema_version == 0) {
      archive_sql(
        database,
        "CREATE TABLE metadata("
        " project_id TEXT PRIMARY KEY,"
        " policy_version INTEGER NOT NULL,"
        " next_sequence INTEGER NOT NULL DEFAULT 0"
        ");"
        "CREATE TABLE pending_captures("
        " event_id TEXT PRIMARY KEY,"
        " run_id TEXT NOT NULL,"
        " segment_id TEXT NOT NULL,"
        " branch_id TEXT NOT NULL,"
        " parent_event_id TEXT,"
        " occurred_at_ms INTEGER NOT NULL,"
        " attachment_count INTEGER NOT NULL,"
        " attachment_kinds TEXT NOT NULL,"
        " prompt_text TEXT NOT NULL"
        ");"
        "CREATE TABLE prompt_entries("
        " event_id TEXT PRIMARY KEY,"
        " sequence INTEGER NOT NULL UNIQUE,"
        " run_id TEXT NOT NULL,"
        " segment_id TEXT NOT NULL,"
        " branch_id TEXT NOT NULL,"
        " parent_event_id TEXT,"
        " occurred_at_ms INTEGER NOT NULL,"
        " source TEXT NOT NULL,"
        " attachment_count INTEGER NOT NULL,"
        " attachment_kinds TEXT NOT NULL,"
        " prompt_text TEXT NOT NULL"
        ");"
        "CREATE INDEX prompt_entries_run_sequence "
        "ON prompt_entries(run_id, sequence);"
        TIMELINE_EVENTS_DDL
        "PRAGMA user_version=2;"
      );
    } else if (schema_version == 1) {
      /* The one declared upgrade: schema 1 gained the non-prompt Timeline
         Event table. It only adds a table, so it preserves every archived row
         and the shared sequence allocator untouched. */
      archive_sql(
        database,
        TIMELINE_EVENTS_DDL
        "PRAGMA user_version=2;"
      );
    } else if (schema_version != 2) {
      archive_sql(database, "ROLLBACK");
      sqlite3_close(database);
      archive_error("schema-version");
    }
    archive_sql(database, "COMMIT");
  }

  sqlite3_stmt *metadata = archive_prepare(
    database,
    "INSERT INTO metadata(project_id, policy_version, next_sequence) "
    "VALUES(?1, 1, 0) ON CONFLICT(project_id) DO NOTHING"
  );
  archive_bind_text(database, metadata, 1, project_id);
  if (sqlite3_step(metadata) != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(metadata);
  metadata = archive_prepare(
    database,
    "SELECT policy_version FROM metadata WHERE project_id=?1"
  );
  archive_bind_text(database, metadata, 1, project_id);
  if (sqlite3_step(metadata) != SQLITE_ROW
      || sqlite3_column_int(metadata, 0) != 1) {
    sqlite3_finalize(metadata);
    sqlite3_close(database);
    archive_error("project-identity");
  }
  sqlite3_finalize(metadata);
  return database;
}

static long long existing_sequence(sqlite3 *database, const char *event_id) {
  sqlite3_stmt *statement = archive_prepare(
    database,
    "SELECT sequence FROM prompt_entries WHERE event_id=?1"
  );
  archive_bind_text(database, statement, 1, event_id);
  long long sequence = sqlite3_step(statement) == SQLITE_ROW
    ? sqlite3_column_int64(statement, 0)
    : 0;
  sqlite3_finalize(statement);
  return sequence;
}

/* Prompt Entries, staged captures and non-prompt Timeline Events share one
   event identity space. An id already spent in any of them is rejected rather
   than becoming two records that a retry cannot tell apart. */
static bool event_id_present(
  sqlite3 *database,
  const char *sql,
  const char *event_id
) {
  sqlite3_stmt *statement = archive_prepare(database, sql);
  archive_bind_text(database, statement, 1, event_id);
  bool present = sqlite3_step(statement) == SQLITE_ROW;
  sqlite3_finalize(statement);
  return present;
}

static bool same_text(const unsigned char *stored, int stored_bytes, const char *value) {
  return stored
    ? value && (size_t)stored_bytes == strlen(value)
      && memcmp(stored, value, (size_t)stored_bytes) == 0
    : value == NULL;
}

/* True when an identical staged capture already exists, so a retry of the same
   pre-write is idempotent; a staged capture that differs fails closed. */
static bool pending_matches(
  sqlite3 *database,
  const char *event_id,
  const char *run_id,
  const char *segment_id,
  const char *branch_id,
  const char *parent_event_id,
  long long occurred_at,
  long long attachment_count,
  const char *attachment_kinds,
  const char *prompt,
  size_t prompt_length
) {
  sqlite3_stmt *statement = archive_prepare(
    database,
    "SELECT run_id, segment_id, branch_id, parent_event_id, occurred_at_ms,"
    " attachment_count, attachment_kinds, prompt_text"
    " FROM pending_captures WHERE event_id=?1"
  );
  archive_bind_text(database, statement, 1, event_id);
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return false;
  }
  const unsigned char *stored_prompt = sqlite3_column_text(statement, 7);
  int stored_prompt_bytes = sqlite3_column_bytes(statement, 7);
  bool identical = strcmp((const char *)sqlite3_column_text(statement, 0), run_id) == 0
    && strcmp((const char *)sqlite3_column_text(statement, 1), segment_id) == 0
    && strcmp((const char *)sqlite3_column_text(statement, 2), branch_id) == 0
    && same_text(
      sqlite3_column_type(statement, 3) == SQLITE_NULL
        ? NULL
        : sqlite3_column_text(statement, 3),
      sqlite3_column_bytes(statement, 3),
      parent_event_id
    )
    && sqlite3_column_int64(statement, 4) == occurred_at
    && sqlite3_column_int64(statement, 5) == attachment_count
    && strcmp((const char *)sqlite3_column_text(statement, 6), attachment_kinds) == 0
    && stored_prompt
    && (size_t)stored_prompt_bytes == prompt_length
    && memcmp(stored_prompt, prompt, prompt_length) == 0;
  sqlite3_finalize(statement);
  if (!identical) archive_error("capture-conflict");
  return true;
}

static void capture_begin(int argc, char **argv) {
  if (argc != 15 || strcmp(argv[14], "--stdin") != 0) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  const char *run_id = argv[4];
  const char *segment_id = argv[5];
  const char *branch_id = argv[6];
  const char *parent_event_id = strcmp(argv[7], "-") == 0 ? NULL : argv[7];
  const char *event_id = argv[8];
  long long occurred_at = nonnegative_integer(argv[9]);
  long long attachment_count = nonnegative_integer(argv[10]);
  const char *attachment_kinds = argv[11];
  if (!pt_is_safe_identifier(run_id)
      || !pt_is_safe_identifier(segment_id)
      || !pt_is_safe_identifier(branch_id)
      || !pt_is_safe_identifier(event_id)
      || (parent_event_id && !pt_is_safe_identifier(parent_event_id))
      || (parent_event_id && strcmp(parent_event_id, event_id) == 0)
      || attachment_count > 100000
      || !attachment_kinds_valid(attachment_kinds)) {
    archive_error("capture-input");
  }
  capture_runtime(database_root, argv[12], argv[13], PT_ROOT_CREATE);

  size_t prompt_length = 0;
  char *prompt = read_prompt_text(&prompt_length);
  sqlite3 *database = open_archive(database_root, project_id, true);
  archive_sql(database, "BEGIN IMMEDIATE");
  if (existing_sequence(database, event_id) > 0
      || event_id_present(
        database,
        "SELECT 1 FROM timeline_events WHERE event_id=?1",
        event_id
      )) {
    archive_error("capture-conflict");
  }
  if (pending_matches(
        database,
        event_id,
        run_id,
        segment_id,
        branch_id,
        parent_event_id,
        occurred_at,
        attachment_count,
        attachment_kinds,
        prompt,
        prompt_length
      )) {
    archive_sql(database, "COMMIT");
    sqlite3_close(database);
    free(prompt);
    write_status_string("{\"eventId\":", event_id);
    write_status_string(",\"projectId\":", project_id);
    fputs(",\"pending\":true}\n", stdout);
    return;
  }
  sqlite3_stmt *insert = archive_prepare(
    database,
    "INSERT INTO pending_captures("
    " event_id, run_id, segment_id, branch_id, parent_event_id,"
    " occurred_at_ms, attachment_count, attachment_kinds, prompt_text"
    ") VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
  );
  archive_bind_text(database, insert, 1, event_id);
  archive_bind_text(database, insert, 2, run_id);
  archive_bind_text(database, insert, 3, segment_id);
  archive_bind_text(database, insert, 4, branch_id);
  archive_bind_text(database, insert, 5, parent_event_id);
  sqlite3_bind_int64(insert, 6, occurred_at);
  sqlite3_bind_int64(insert, 7, attachment_count);
  archive_bind_text(database, insert, 8, attachment_kinds);
  archive_bind_prompt(insert, 9, prompt, prompt_length);
  if (sqlite3_step(insert) != SQLITE_DONE) archive_error("capture-conflict");
  sqlite3_finalize(insert);
  archive_sql(database, "COMMIT");
  sqlite3_close(database);
  free(prompt);

  write_status_string("{\"eventId\":", event_id);
  write_status_string(",\"projectId\":", project_id);
  fputs(",\"pending\":true}\n", stdout);
}

static void discard_pending(sqlite3 *database, const char *event_id) {
  sqlite3_stmt *remove = archive_prepare(
    database,
    "DELETE FROM pending_captures WHERE event_id=?1"
  );
  archive_bind_text(database, remove, 1, event_id);
  if (sqlite3_step(remove) != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(remove);
}

static void require_known_parent(sqlite3 *database, const char *parent_event_id) {
  if (!parent_event_id) return;
  if (existing_sequence(database, parent_event_id) <= 0) {
    archive_error("capture-parent-unknown");
  }
}

static void write_confirmation(
  const char *event_id,
  const char *project_id,
  long long sequence
) {
  write_status_string("{\"eventId\":", event_id);
  write_status_string(",\"projectId\":", project_id);
  printf(",\"sequence\":%lld}\n", sequence);
}

static long long allocate_sequence(sqlite3 *database, const char *project_id) {
  sqlite3_stmt *allocate = archive_prepare(
    database,
    "UPDATE metadata SET next_sequence=next_sequence+1 WHERE project_id=?1 "
    "RETURNING next_sequence"
  );
  archive_bind_text(database, allocate, 1, project_id);
  if (sqlite3_step(allocate) != SQLITE_ROW) archive_error("archive-sqlite");
  long long sequence = sqlite3_column_int64(allocate, 0);
  sqlite3_finalize(allocate);
  return sequence;
}

/* `--stdin` confirms with the text `next(e)` returned; `--pending` confirms
   with the text already staged, which is the only form a reconciliation after
   a restart can use — the plugin no longer holds the draft, and the staged
   bytes never leave the helper. */
static void capture_confirm(int argc, char **argv) {
  if (argc != 8) usage();
  bool from_stdin = strcmp(argv[7], "--stdin") == 0;
  if (!from_stdin && strcmp(argv[7], "--pending") != 0) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  const char *event_id = argv[4];
  if (!pt_is_safe_identifier(event_id)) archive_error("capture-input");
  capture_runtime(database_root, argv[5], argv[6], PT_ROOT_REQUIRE);

  size_t prompt_length = 0;
  char *prompt = from_stdin ? read_prompt_text(&prompt_length) : NULL;
  sqlite3 *database = open_archive(database_root, project_id, false);
  archive_sql(database, "BEGIN IMMEDIATE");
  long long sequence = existing_sequence(database, event_id);
  if (sequence > 0) {
    discard_pending(database, event_id);
    archive_sql(database, "COMMIT");
    sqlite3_close(database);
    free(prompt);
    write_confirmation(event_id, project_id, sequence);
    return;
  }

  sqlite3_stmt *pending = archive_prepare(
    database,
    "SELECT run_id, segment_id, branch_id, parent_event_id, occurred_at_ms,"
    " attachment_count, attachment_kinds, prompt_text"
    " FROM pending_captures WHERE event_id=?1"
  );
  archive_bind_text(database, pending, 1, event_id);
  if (sqlite3_step(pending) != SQLITE_ROW) archive_error("capture-not-found");
  const char *run_id = (const char *)sqlite3_column_text(pending, 0);
  const char *segment_id = (const char *)sqlite3_column_text(pending, 1);
  const char *branch_id = (const char *)sqlite3_column_text(pending, 2);
  const char *parent_event_id = sqlite3_column_type(pending, 3) == SQLITE_NULL
    ? NULL
    : (const char *)sqlite3_column_text(pending, 3);
  long long occurred_at = sqlite3_column_int64(pending, 4);
  long long attachment_count = sqlite3_column_int64(pending, 5);
  const char *attachment_kinds = (const char *)sqlite3_column_text(pending, 6);
  if (!from_stdin) {
    /* The row stays on this statement, which is not stepped again before the
       insert binds it, so the staged bytes are read straight across. */
    prompt = (char *)sqlite3_column_text(pending, 7);
    prompt_length = (size_t)sqlite3_column_bytes(pending, 7);
  }
  require_known_parent(database, parent_event_id);

  sequence = allocate_sequence(database, project_id);

  sqlite3_stmt *insert = archive_prepare(
    database,
    "INSERT INTO prompt_entries("
    " event_id, sequence, run_id, segment_id, branch_id, parent_event_id,"
    " occurred_at_ms, source, attachment_count, attachment_kinds, prompt_text"
    ") VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'composer', ?8, ?9, ?10)"
  );
  archive_bind_text(database, insert, 1, event_id);
  sqlite3_bind_int64(insert, 2, sequence);
  archive_bind_text(database, insert, 3, run_id);
  archive_bind_text(database, insert, 4, segment_id);
  archive_bind_text(database, insert, 5, branch_id);
  archive_bind_text(database, insert, 6, parent_event_id);
  sqlite3_bind_int64(insert, 7, occurred_at);
  sqlite3_bind_int64(insert, 8, attachment_count);
  archive_bind_text(database, insert, 9, attachment_kinds);
  archive_bind_prompt(insert, 10, prompt, prompt_length);
  if (sqlite3_step(insert) != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(insert);
  if (!from_stdin) prompt = NULL;
  sqlite3_finalize(pending);

  sqlite3_stmt *remove = archive_prepare(
    database,
    "DELETE FROM pending_captures WHERE event_id=?1"
  );
  archive_bind_text(database, remove, 1, event_id);
  if (sqlite3_step(remove) != SQLITE_DONE || sqlite3_changes(database) != 1) {
    archive_error("archive-sqlite");
  }
  sqlite3_finalize(remove);
  archive_sql(database, "COMMIT");
  sqlite3_close(database);
  free(prompt);
  write_confirmation(event_id, project_id, sequence);
}

static void capture_abort(int argc, char **argv) {
  if (argc != 7) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  const char *event_id = argv[4];
  if (!pt_is_safe_identifier(event_id)) archive_error("capture-input");
  capture_runtime(database_root, argv[5], argv[6], PT_ROOT_REQUIRE);
  sqlite3 *database = open_archive(database_root, project_id, false);
  archive_sql(database, "BEGIN IMMEDIATE");
  if (existing_sequence(database, event_id) > 0) {
    archive_error("capture-conflict");
  }
  sqlite3_stmt *remove = archive_prepare(
    database,
    "DELETE FROM pending_captures WHERE event_id=?1"
  );
  archive_bind_text(database, remove, 1, event_id);
  if (sqlite3_step(remove) != SQLITE_DONE) archive_error("archive-sqlite");
  int removed = sqlite3_changes(database);
  sqlite3_finalize(remove);
  archive_sql(database, "COMMIT");
  sqlite3_close(database);
  printf("{\"aborted\":%s}\n", removed > 0 ? "true" : "false");
}

/* The fixed maximum batch a single listing answers. The protocol offers no
   way to ask for more in one call, so a caller cannot turn this read into an
   unbounded table scan; `truncated` says another call is owed. */
#define PENDING_LIST_LIMIT 64

/* Unresolved Pending Captures, oldest staged first. It answers identity only —
   no prompt text and no attachment kinds — because its whole job is to let a
   Run discover, after a crash or a restart, that something is owed. */
static void capture_list(int argc, char **argv) {
  if (argc != 6) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  if (!lowercase_sha256(project_id)) archive_error("project-identity");
  bool root_present =
    capture_runtime(database_root, argv[4], argv[5], PT_ROOT_OPTIONAL);

  bool archived = false;
  if (root_present) {
    char database_path[PATH_MAX];
    int length = snprintf(
      database_path,
      sizeof(database_path),
      "%s/%s.sqlite3",
      database_root,
      project_id
    );
    if (length < 0 || (size_t)length >= sizeof(database_path)) {
      archive_error("database-path");
    }
    struct stat status;
    if (lstat(database_path, &status) == 0) {
      archived = true;
    } else if (errno != ENOENT) {
      archive_error("database-unavailable");
    }
  }

  /* An archive that was never created owes nothing, which is an answer rather
     than a failure: the caller asked whether anything is unresolved. */
  if (!archived) {
    write_status_string("{\"projectId\":", project_id);
    fputs(",\"pending\":[],\"truncated\":false}\n", stdout);
    return;
  }

  sqlite3 *database = open_archive(database_root, project_id, false);
  sqlite3_stmt *rows = archive_prepare(
    database,
    "SELECT event_id, run_id, segment_id, branch_id, parent_event_id,"
    " occurred_at_ms, attachment_count"
    " FROM pending_captures ORDER BY rowid LIMIT ?1"
  );
  sqlite3_bind_int(rows, 1, PENDING_LIST_LIMIT + 1);

  write_status_string("{\"projectId\":", project_id);
  fputs(",\"pending\":[", stdout);
  int listed = 0;
  bool truncated = false;
  int step;
  while ((step = sqlite3_step(rows)) == SQLITE_ROW) {
    if (listed == PENDING_LIST_LIMIT) {
      truncated = true;
      break;
    }
    const char *parent = sqlite3_column_type(rows, 4) == SQLITE_NULL
      ? NULL
      : (const char *)sqlite3_column_text(rows, 4);
    if (listed > 0) fputs(",", stdout);
    write_status_string("{\"eventId\":", (const char *)sqlite3_column_text(rows, 0));
    write_status_string(",\"runId\":", (const char *)sqlite3_column_text(rows, 1));
    write_status_string(",\"segmentId\":", (const char *)sqlite3_column_text(rows, 2));
    write_status_string(",\"branchId\":", (const char *)sqlite3_column_text(rows, 3));
    if (parent) {
      write_status_string(",\"parentEventId\":", parent);
    } else {
      fputs(",\"parentEventId\":null", stdout);
    }
    printf(
      ",\"occurredAtMs\":%lld,\"attachmentCount\":%lld}",
      (long long)sqlite3_column_int64(rows, 5),
      (long long)sqlite3_column_int64(rows, 6)
    );
    listed++;
  }
  if (step != SQLITE_ROW && step != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(rows);
  sqlite3_close(database);
  printf("],\"truncated\":%s}\n", truncated ? "true" : "false");
}

/* The kinds of non-prompt Timeline Event this protocol accepts. `clear` is the
   Clear Boundary that ends a Conversation Segment; `run-started` is a Run's
   first appearance, and `run-attached` and `run-detached` a process taking the
   Run up again and leaving it — a Run is a conversation's lineage, so it is
   never ended, only left; the other three record one Run's
   collection starting, stopping and resuming. They differ only in this list:
   the table, the sequence allocator and the idempotency rule are shared. An
   unknown kind fails closed rather than entering the archive. */
static bool boundary_kind_valid(const char *kind) {
  return strcmp(kind, "collection-started") == 0
    || strcmp(kind, "collection-stopped") == 0
    || strcmp(kind, "collection-resumed") == 0
    || strcmp(kind, "clear") == 0
    || strcmp(kind, "run-started") == 0
    || strcmp(kind, "run-attached") == 0
    || strcmp(kind, "run-detached") == 0;
}

/* A repeat of the same boundary is idempotent only when every recorded field
   matches; a reused id carrying different facts fails closed instead of
   silently answering the stored sequence. */
static long long existing_boundary_sequence(
  sqlite3 *database,
  const char *event_id,
  const char *kind,
  const char *run_id,
  const char *segment_id,
  const char *branch_id,
  long long occurred_at
) {
  sqlite3_stmt *statement = archive_prepare(
    database,
    "SELECT sequence, kind, run_id, segment_id, branch_id, occurred_at_ms"
    " FROM timeline_events WHERE event_id=?1"
  );
  archive_bind_text(database, statement, 1, event_id);
  long long sequence = 0;
  if (sqlite3_step(statement) == SQLITE_ROW) {
    sequence = sqlite3_column_int64(statement, 0);
    bool identical =
      strcmp((const char *)sqlite3_column_text(statement, 1), kind) == 0
      && strcmp((const char *)sqlite3_column_text(statement, 2), run_id) == 0
      && strcmp((const char *)sqlite3_column_text(statement, 3), segment_id) == 0
      && strcmp((const char *)sqlite3_column_text(statement, 4), branch_id) == 0
      && sqlite3_column_int64(statement, 5) == occurred_at;
    sqlite3_finalize(statement);
    if (!identical) archive_error("boundary-conflict");
    return sequence;
  }
  sqlite3_finalize(statement);
  return sequence;
}

static void boundary_append(int argc, char **argv) {
  if (argc != 12) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  const char *run_id = argv[4];
  const char *segment_id = argv[5];
  const char *branch_id = argv[6];
  const char *kind = argv[7];
  const char *event_id = argv[8];
  long long occurred_at = nonnegative_integer(argv[9]);
  if (!pt_is_safe_identifier(run_id)
      || !pt_is_safe_identifier(segment_id)
      || !pt_is_safe_identifier(branch_id)
      || !pt_is_safe_identifier(event_id)
      || !boundary_kind_valid(kind)) {
    archive_error("boundary-input");
  }
  capture_runtime(database_root, argv[10], argv[11], PT_ROOT_CREATE);

  sqlite3 *database = open_archive(database_root, project_id, true);
  archive_sql(database, "BEGIN IMMEDIATE");
  if (existing_sequence(database, event_id) > 0
      || event_id_present(
        database,
        "SELECT 1 FROM pending_captures WHERE event_id=?1",
        event_id
      )) {
    archive_error("boundary-conflict");
  }
  long long sequence = existing_boundary_sequence(
    database,
    event_id,
    kind,
    run_id,
    segment_id,
    branch_id,
    occurred_at
  );
  if (sequence == 0) {
    sequence = allocate_sequence(database, project_id);

    sqlite3_stmt *insert = archive_prepare(
      database,
      "INSERT INTO timeline_events("
      " event_id, sequence, kind, run_id, segment_id, branch_id, occurred_at_ms"
      ") VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    );
    archive_bind_text(database, insert, 1, event_id);
    sqlite3_bind_int64(insert, 2, sequence);
    archive_bind_text(database, insert, 3, kind);
    archive_bind_text(database, insert, 4, run_id);
    archive_bind_text(database, insert, 5, segment_id);
    archive_bind_text(database, insert, 6, branch_id);
    sqlite3_bind_int64(insert, 7, occurred_at);
    if (sqlite3_step(insert) != SQLITE_DONE) archive_error("boundary-conflict");
    sqlite3_finalize(insert);
  }
  archive_sql(database, "COMMIT");
  sqlite3_close(database);

  write_status_string("{\"eventId\":", event_id);
  write_status_string(",\"projectId\":", project_id);
  write_status_string(",\"kind\":", kind);
  printf(",\"sequence\":%lld}\n", sequence);
}

/* The latest Timeline Events of one Project Timeline, oldest first: Prompt
   Entries and non-prompt boundaries interleaved by the project-level sequence
   alone. The batch is fixed here, never chosen by the caller, so no request can
   read the whole table; `truncated` says earlier events exist.

   This is the one subcommand whose response carries prompt text. It goes to
   the hook that asked, for display, and nowhere else: never argv, never
   stderr, never an error. A staged Pending Capture is not a Prompt Entry and
   is never read back. */
#define TIMELINE_READ_LIMIT 128

static void timeline_read(int argc, char **argv) {
  if (argc != 6) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  if (!lowercase_sha256(project_id)) archive_error("project-identity");
  bool root_present =
    capture_runtime(database_root, argv[4], argv[5], PT_ROOT_OPTIONAL);

  bool archived = false;
  if (root_present) {
    char database_path[PATH_MAX];
    int length = snprintf(
      database_path,
      sizeof(database_path),
      "%s/%s.sqlite3",
      database_root,
      project_id
    );
    if (length < 0 || (size_t)length >= sizeof(database_path)) {
      archive_error("database-path");
    }
    struct stat status;
    if (lstat(database_path, &status) == 0) {
      archived = true;
    } else if (errno != ENOENT) {
      archive_error("database-unavailable");
    }
  }

  if (!archived) {
    write_status_string("{\"projectId\":", project_id);
    fputs(",\"events\":[],\"truncated\":false}\n", stdout);
    return;
  }

  sqlite3 *database = open_archive(database_root, project_id, false);
  /* One more than the batch is fetched newest-first; if it arrives, the
     oldest of them only proves that earlier events exist and is not shown. */
  sqlite3_stmt *rows = archive_prepare(
    database,
    "SELECT event_id, sequence, run_id, kind, prompt_text, attachment_count,"
    " count(*) OVER (), segment_id, branch_id, parent_event_id FROM ("
    "  SELECT event_id, sequence, run_id, 'prompt' AS kind, prompt_text,"
    "   attachment_count, segment_id, branch_id, parent_event_id"
    "   FROM prompt_entries"
    "  UNION ALL"
    "  SELECT event_id, sequence, run_id, kind, NULL, 0, segment_id, branch_id,"
    "   NULL FROM timeline_events"
    "  ORDER BY sequence DESC LIMIT ?1"
    ") ORDER BY sequence ASC"
  );
  sqlite3_bind_int(rows, 1, TIMELINE_READ_LIMIT + 1);

  write_status_string("{\"projectId\":", project_id);
  fputs(",\"events\":[", stdout);
  bool truncated = false;
  bool first_row = true;
  int listed = 0;
  int step;
  while ((step = sqlite3_step(rows)) == SQLITE_ROW) {
    if (first_row && sqlite3_column_int(rows, 6) > TIMELINE_READ_LIMIT) {
      truncated = true;
      first_row = false;
      continue;
    }
    first_row = false;
    if (listed > 0) fputs(",", stdout);
    write_status_string("{\"eventId\":", (const char *)sqlite3_column_text(rows, 0));
    printf(",\"sequence\":%lld", (long long)sqlite3_column_int64(rows, 1));
    write_status_string(",\"runId\":", (const char *)sqlite3_column_text(rows, 2));
    write_status_string(",\"segmentId\":", (const char *)sqlite3_column_text(rows, 7));
    write_status_string(",\"branchId\":", (const char *)sqlite3_column_text(rows, 8));
    const char *kind = (const char *)sqlite3_column_text(rows, 3);
    write_status_string(",\"kind\":", kind);
    if (strcmp(kind, "prompt") == 0) {
      if (sqlite3_column_type(rows, 9) == SQLITE_NULL) {
        fputs(",\"parentEventId\":null", stdout);
      } else {
        write_status_string(",\"parentEventId\":", (const char *)sqlite3_column_text(rows, 9));
      }
      write_status_string(",\"text\":", (const char *)sqlite3_column_text(rows, 4));
      printf(",\"attachmentCount\":%lld", (long long)sqlite3_column_int64(rows, 5));
    }
    fputs("}", stdout);
    listed++;
  }
  if (step != SQLITE_ROW && step != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(rows);
  sqlite3_close(database);
  printf("],\"truncated\":%s}\n", truncated ? "true" : "false");
}

/* `branch-match` answers which archived Prompt Entry a transcript ends on, so
   a resumed or forked Run can continue its Active Branch without guessing. The
   transcript's `user` rows arrive on stdin in order, each as `<bytes>\n<text>`;
   the answer names event ids only, never text.

   An entry matches when its whole chain, root first, is an ordered subsequence
   of those rows: the rows in between are the engine's own (a task
   notification) or prompts no Run archived. Of the matches, the one whose own
   row comes latest wins, then the longer chain; a tie is ambiguous and left to
   the caller. A transcript cut to its newest rows (`truncated`) may hold only
   the tail of a chain, so there a chain whose head lies beyond the first row
   still matches. */
#define MATCH_ROW_LIMIT 4096
#define MATCH_INPUT_LIMIT ((size_t)64 * 1024 * 1024)
#define MATCH_CANDIDATE_LIMIT 8

typedef struct {
  const char *text;
  size_t length;
} match_row;

typedef struct {
  char event_id[129];
  char run_id[129];
  long long sequence;
  int chain_length;
} match_candidate;

static void match_error(void) {
  archive_error("match-input");
}

static size_t parse_match_rows(
  const char *input,
  size_t input_length,
  match_row *rows
) {
  size_t count = 0;
  size_t cursor = 0;
  while (cursor < input_length) {
    if (count == MATCH_ROW_LIMIT) match_error();
    size_t length = 0;
    size_t digits = 0;
    while (cursor < input_length && isdigit((unsigned char)input[cursor])) {
      if (digits == 9) match_error();
      length = length * 10 + (size_t)(input[cursor] - '0');
      cursor += 1;
      digits += 1;
    }
    if (digits == 0 || cursor >= input_length || input[cursor] != '\n') {
      match_error();
    }
    cursor += 1;
    if (length > input_length - cursor) match_error();
    rows[count].text = input + cursor;
    rows[count].length = length;
    count += 1;
    cursor += length;
  }
  return count;
}

static bool row_equals(
  const match_row *row,
  const unsigned char *text,
  int text_bytes
) {
  return text_bytes >= 0
    && row->length == (size_t)text_bytes
    && (row->length == 0 || memcmp(row->text, text, row->length) == 0);
}

/* Walks the chain above one candidate whose own row is `position`, finding
   each ancestor at the latest row before the one its child took. Answers the
   chain's length, or 0 when an ancestor is missing from a whole transcript. */
static int match_chain(
  sqlite3 *database,
  sqlite3_stmt *parent,
  const match_row *rows,
  long long position,
  const char *event_id,
  bool truncated
) {
  char current[129];
  snprintf(current, sizeof(current), "%s", event_id);
  int length = 1;
  long long cursor = position - 1;
  for (;;) {
    sqlite3_reset(parent);
    archive_bind_text(database, parent, 1, current);
    int step = sqlite3_step(parent);
    if (step == SQLITE_DONE) break;
    if (step != SQLITE_ROW) archive_error("archive-sqlite");
    const unsigned char *text = sqlite3_column_text(parent, 1);
    int text_bytes = sqlite3_column_bytes(parent, 1);
    while (cursor >= 0 && !row_equals(&rows[cursor], text, text_bytes)) {
      cursor -= 1;
    }
    if (cursor < 0) {
      if (!truncated) length = 0;
      break;
    }
    snprintf(current, sizeof(current), "%s", (const char *)sqlite3_column_text(parent, 0));
    length += 1;
    cursor -= 1;
  }
  return length;
}

/* The one tied candidate the lineage ending at `prefer` passes through, or
   -1 when it passes through none or several. Several happen when earlier rows
   are missing: a transcript of two repeats may be the tail of three, and
   either of the later two could be where it ends. */
static int lineage_winner(
  sqlite3 *database,
  sqlite3_stmt *parent,
  const char *prefer,
  const match_candidate *winners,
  int winner_count
) {
  char current[129];
  snprintf(current, sizeof(current), "%s", prefer);
  int found = -1;
  for (;;) {
    for (int index = 0; index < winner_count; index += 1) {
      if (strcmp(winners[index].event_id, current) != 0) continue;
      if (found >= 0) return -1;
      found = index;
    }
    sqlite3_reset(parent);
    archive_bind_text(database, parent, 1, current);
    int step = sqlite3_step(parent);
    if (step == SQLITE_DONE) return found;
    if (step != SQLITE_ROW) archive_error("archive-sqlite");
    snprintf(current, sizeof(current), "%s", (const char *)sqlite3_column_text(parent, 0));
  }
}

static void write_match(
  const char *project_id,
  const match_candidate *winners,
  int winner_count
) {
  write_status_string("{\"projectId\":", project_id);
  const char *match = winner_count == 0
    ? "none"
    : winner_count == 1 ? "unique" : "ambiguous";
  printf(",\"match\":\"%s\"", match);
  if (winner_count == 1) {
    write_status_string(",\"eventId\":", winners[0].event_id);
  }
  fputs(",\"candidates\":[", stdout);
  for (int index = 0; index < winner_count && index < MATCH_CANDIDATE_LIMIT; index += 1) {
    if (index > 0) fputs(",", stdout);
    write_status_string("{\"eventId\":", winners[index].event_id);
    printf(",\"sequence\":%lld", winners[index].sequence);
    write_status_string(",\"runId\":", winners[index].run_id);
    fputs("}", stdout);
  }
  printf("],\"candidateCount\":%d}\n", winner_count);
}

static int compare_newest_first(const void *left, const void *right) {
  long long a = ((const match_candidate *)left)->sequence;
  long long b = ((const match_candidate *)right)->sequence;
  return a < b ? 1 : a > b ? -1 : 0;
}

static void branch_match(int argc, char **argv) {
  if (argc != 11 || strcmp(argv[10], "--stdin") != 0) usage();
  const char *database_root = argv[2];
  const char *project_id = argv[3];
  const char *run_id = argv[4];
  const char *segment_id = argv[5];
  const char *transcript = argv[6];
  /* The stored parent, when there is one: a tie its lineage passes through
     once is settled on that candidate. */
  const char *prefer = argv[7];
  if (!lowercase_sha256(project_id)) archive_error("project-identity");
  if (strcmp(prefer, "-") != 0 && !pt_is_safe_identifier(prefer)) match_error();
  bool scoped = strcmp(run_id, "-") != 0;
  if (scoped != (strcmp(segment_id, "-") != 0)
      || (scoped && (!pt_is_safe_identifier(run_id)
                     || !pt_is_safe_identifier(segment_id)))) {
    match_error();
  }
  bool truncated;
  if (strcmp(transcript, "whole") == 0) {
    truncated = false;
  } else if (strcmp(transcript, "truncated") == 0) {
    truncated = true;
  } else {
    match_error();
  }
  bool root_present =
    capture_runtime(database_root, argv[8], argv[9], PT_ROOT_OPTIONAL);

  char *input = NULL;
  size_t input_length = 0;
  if (!pt_read_fd_limited(STDIN_FILENO, &input, &input_length, MATCH_INPUT_LIMIT)) {
    match_error();
  }
  match_row *rows = calloc(MATCH_ROW_LIMIT, sizeof(match_row));
  if (!rows) archive_error("archive-memory");
  size_t row_count = parse_match_rows(input, input_length, rows);

  bool archived = false;
  if (root_present) {
    char database_path[PATH_MAX];
    int length = snprintf(
      database_path,
      sizeof(database_path),
      "%s/%s.sqlite3",
      database_root,
      project_id
    );
    if (length < 0 || (size_t)length >= sizeof(database_path)) {
      archive_error("database-path");
    }
    struct stat status;
    if (lstat(database_path, &status) == 0) {
      archived = true;
    } else if (errno != ENOENT) {
      archive_error("database-unavailable");
    }
  }
  if (!archived || row_count == 0) {
    write_match(project_id, NULL, 0);
    free(rows);
    free(input);
    return;
  }

  sqlite3 *database = open_archive(database_root, project_id, false);
  archive_sql(
    database,
    "CREATE TEMP TABLE transcript_rows(position INTEGER PRIMARY KEY, text TEXT);"
  );
  sqlite3_stmt *insert = archive_prepare(
    database,
    "INSERT INTO temp.transcript_rows(position, text) VALUES(?1, ?2)"
  );
  for (size_t index = 0; index < row_count; index += 1) {
    sqlite3_reset(insert);
    sqlite3_bind_int64(insert, 1, (sqlite3_int64)index);
    archive_bind_prompt(insert, 2, rows[index].text, rows[index].length);
    if (sqlite3_step(insert) != SQLITE_DONE) archive_error("archive-sqlite");
  }
  sqlite3_finalize(insert);
  archive_sql(
    database,
    "CREATE INDEX temp.transcript_rows_text ON transcript_rows(text);"
  );

  /* A resume looks in its own session's stretch of the Run first; a session
     that archived nothing there (a fork that never submitted, say) is matched
     against the whole project, as a fork is. */
  if (scoped) {
    sqlite3_stmt *present = archive_prepare(
      database,
      "SELECT 1 FROM prompt_entries WHERE run_id=?1 AND segment_id=?2 LIMIT 1"
    );
    archive_bind_text(database, present, 1, run_id);
    archive_bind_text(database, present, 2, segment_id);
    int step = sqlite3_step(present);
    if (step != SQLITE_ROW && step != SQLITE_DONE) archive_error("archive-sqlite");
    scoped = step == SQLITE_ROW;
    sqlite3_finalize(present);
  }

  sqlite3_stmt *candidates = archive_prepare(
    database,
    "SELECT entry.event_id, entry.run_id, entry.sequence, max(row.position)"
    " FROM prompt_entries entry"
    " JOIN temp.transcript_rows row ON row.text = entry.prompt_text"
    " WHERE ?1 IS NULL OR (entry.run_id = ?1 AND entry.segment_id = ?2)"
    " GROUP BY entry.event_id ORDER BY 4 DESC"
  );
  archive_bind_text(database, candidates, 1, scoped ? run_id : NULL);
  archive_bind_text(database, candidates, 2, scoped ? segment_id : NULL);

  sqlite3_stmt *parent = archive_prepare(
    database,
    "SELECT parent.event_id, parent.prompt_text FROM prompt_entries child"
    " JOIN prompt_entries parent ON parent.event_id = child.parent_event_id"
    " WHERE child.event_id = ?1"
  );
  size_t capacity = 16;
  match_candidate *winners = calloc(capacity, sizeof(match_candidate));
  if (!winners) archive_error("archive-memory");
  int winner_count = 0;
  int best_length = 0;
  long long settled_position = -1;
  int step;
  while ((step = sqlite3_step(candidates)) == SQLITE_ROW) {
    long long position = sqlite3_column_int64(candidates, 3);
    /* Every candidate on the latest row that holds a match has been weighed;
       an earlier row can only lose to it. */
    if (winner_count > 0 && position < settled_position) break;
    const char *event_id = (const char *)sqlite3_column_text(candidates, 0);
    int length = match_chain(database, parent, rows, position, event_id, truncated);
    if (length == 0 || length < best_length) continue;
    if (length > best_length) {
      best_length = length;
      winner_count = 0;
    }
    if ((size_t)winner_count == capacity) {
      capacity *= 2;
      match_candidate *larger = realloc(winners, capacity * sizeof(match_candidate));
      if (!larger) archive_error("archive-memory");
      winners = larger;
    }
    match_candidate *winner = &winners[winner_count];
    snprintf(winner->event_id, sizeof(winner->event_id), "%s", event_id);
    snprintf(
      winner->run_id,
      sizeof(winner->run_id),
      "%s",
      (const char *)sqlite3_column_text(candidates, 1)
    );
    winner->sequence = sqlite3_column_int64(candidates, 2);
    winner->chain_length = length;
    winner_count += 1;
    settled_position = position;
  }
  if (step != SQLITE_ROW && step != SQLITE_DONE) archive_error("archive-sqlite");
  sqlite3_finalize(candidates);
  /* A rewind only shortens the transcript, so it is a prefix of the lineage
     the session was on: of tied candidates, the one that lineage passes
     through is where it was rewound to. */
  if (winner_count > 1 && strcmp(prefer, "-") != 0) {
    int on_lineage = lineage_winner(database, parent, prefer, winners, winner_count);
    if (on_lineage >= 0) {
      winners[0] = winners[on_lineage];
      winner_count = 1;
    }
  }
  sqlite3_finalize(parent);
  sqlite3_close(database);

  qsort(winners, (size_t)winner_count, sizeof(match_candidate), compare_newest_first);
  write_match(project_id, winners, winner_count);
  free(winners);
  free(rows);
  free(input);
}

static void usage(void) {
  fputs("{\"category\":\"invalid-command\"}\n", stderr);
  exit(2);
}

int main(int argc, char **argv) {
  umask(0077);
  if (argc == 4
      && strcmp(argv[1], "probe") == 0
      && strcmp(argv[2], "--protocol") == 0) {
    probe(argv[3]);
    return 0;
  }
  if (argc == 10
      && strcmp(argv[1], "preflight") == 0
      && strcmp(argv[2], "--locator") == 0
      && strcmp(argv[4], "--session") == 0
      && strcmp(argv[6], "--expected-sha") == 0
      && strcmp(argv[8], "--protocol") == 0) {
    preflight(argv[3], argv[5], argv[7], argv[9]);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "capture-begin") == 0) {
    capture_begin(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "capture-confirm") == 0) {
    capture_confirm(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "capture-abort") == 0) {
    capture_abort(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "capture-list") == 0) {
    capture_list(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "boundary-append") == 0) {
    boundary_append(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "timeline-read") == 0) {
    timeline_read(argc, argv);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "branch-match") == 0) {
    branch_match(argc, argv);
    return 0;
  }
  usage();
}

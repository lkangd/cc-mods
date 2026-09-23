#ifndef PROMPT_TRAIL_COMMON_H
#define PROMPT_TRAIL_COMMON_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define PT_TEXT_LIMIT (1024 * 1024)

bool pt_read_fd(int descriptor, char **output, size_t *length);
bool pt_read_fd_limited(
  int descriptor,
  char **output,
  size_t *length,
  size_t limit
);
bool pt_read_file(const char *path, char **output, size_t *length);
bool pt_json_validate(const char *json);
bool pt_json_get_string(
  const char *json,
  const char *key,
  char *output,
  size_t capacity
);
bool pt_json_get_i64(const char *json, const char *key, int64_t *output);
void pt_write_json_string(int descriptor, const char *value);
bool pt_process_identity(
  pid_t process_id,
  char *executable,
  size_t executable_capacity,
  int64_t *start_seconds,
  int64_t *start_microseconds
);
bool pt_process_is_same(
  pid_t process_id,
  int64_t start_seconds,
  int64_t start_microseconds
);
bool pt_executable_version(const char *executable, char *output, size_t capacity);
bool pt_sha256_file(const char *path, char output[65]);
bool pt_is_safe_identifier(const char *value);
void pt_random_uuid(char output[37]);
/* A locator's file name: the session and the host process generation that
   published it, `<session>.<pid>-<start s>-<start µs>.json`. The bridge
   publishes under it and the helper accepts only the one naming its own host. */
bool pt_locator_file_name(
  const char *session_id,
  int64_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds,
  char *output,
  size_t capacity
);
bool pt_path_is_private_directory(const char *path);
bool pt_path_is_private_file(const char *path);
bool pt_ensure_private_directory(const char *path);
bool pt_has_extended_acl(const char *path);
bool pt_has_write_grant_acl(const char *path);

#endif

#define _DARWIN_C_SOURCE

#include "prompt_trail_common.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <paths.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

typedef struct {
  const char *cursor;
  unsigned depth;
} JsonParser;

static void skip_whitespace(JsonParser *parser) {
  while (isspace((unsigned char)*parser->cursor)) parser->cursor += 1;
}

static bool append_byte(char *output, size_t capacity, size_t *length, unsigned char byte) {
  if (output && *length + 1 >= capacity) return false;
  if (output) output[*length] = (char)byte;
  *length += 1;
  return true;
}

static bool append_codepoint(
  char *output,
  size_t capacity,
  size_t *length,
  unsigned codepoint
) {
  if (codepoint <= 0x7f) return append_byte(output, capacity, length, codepoint);
  if (codepoint <= 0x7ff) {
    return append_byte(output, capacity, length, 0xc0u | (codepoint >> 6))
      && append_byte(output, capacity, length, 0x80u | (codepoint & 0x3fu));
  }
  if (codepoint <= 0xffff) {
    return append_byte(output, capacity, length, 0xe0u | (codepoint >> 12))
      && append_byte(output, capacity, length, 0x80u | ((codepoint >> 6) & 0x3fu))
      && append_byte(output, capacity, length, 0x80u | (codepoint & 0x3fu));
  }
  if (codepoint <= 0x10ffff) {
    return append_byte(output, capacity, length, 0xf0u | (codepoint >> 18))
      && append_byte(output, capacity, length, 0x80u | ((codepoint >> 12) & 0x3fu))
      && append_byte(output, capacity, length, 0x80u | ((codepoint >> 6) & 0x3fu))
      && append_byte(output, capacity, length, 0x80u | (codepoint & 0x3fu));
  }
  return false;
}

static int hex_value(char character) {
  if (character >= '0' && character <= '9') return character - '0';
  if (character >= 'a' && character <= 'f') return character - 'a' + 10;
  if (character >= 'A' && character <= 'F') return character - 'A' + 10;
  return -1;
}

static bool parse_hex4(JsonParser *parser, unsigned *value) {
  unsigned result = 0;
  for (int index = 0; index < 4; index += 1) {
    int digit = hex_value(parser->cursor[index]);
    if (digit < 0) return false;
    result = (result << 4) | (unsigned)digit;
  }
  parser->cursor += 4;
  *value = result;
  return true;
}

static bool parse_string(
  JsonParser *parser,
  char *output,
  size_t capacity,
  size_t *written
) {
  if (*parser->cursor != '"') return false;
  parser->cursor += 1;
  size_t length = 0;

  while (*parser->cursor && *parser->cursor != '"') {
    unsigned char byte = (unsigned char)*parser->cursor++;
    if (byte < 0x20) return false;
    if (byte != '\\') {
      if (!append_byte(output, capacity, &length, byte)) return false;
      continue;
    }

    char escape = *parser->cursor++;
    switch (escape) {
      case '"': case '\\': case '/':
        if (!append_byte(output, capacity, &length, (unsigned char)escape)) return false;
        break;
      case 'b':
        if (!append_byte(output, capacity, &length, '\b')) return false;
        break;
      case 'f':
        if (!append_byte(output, capacity, &length, '\f')) return false;
        break;
      case 'n':
        if (!append_byte(output, capacity, &length, '\n')) return false;
        break;
      case 'r':
        if (!append_byte(output, capacity, &length, '\r')) return false;
        break;
      case 't':
        if (!append_byte(output, capacity, &length, '\t')) return false;
        break;
      case 'u': {
        unsigned codepoint = 0;
        if (!parse_hex4(parser, &codepoint)) return false;
        if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
          if (parser->cursor[0] != '\\' || parser->cursor[1] != 'u') return false;
          parser->cursor += 2;
          unsigned low = 0;
          if (!parse_hex4(parser, &low) || low < 0xdc00 || low > 0xdfff) return false;
          codepoint = 0x10000u + ((codepoint - 0xd800u) << 10) + (low - 0xdc00u);
        } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) {
          return false;
        }
        if (!append_codepoint(output, capacity, &length, codepoint)) return false;
        break;
      }
      default:
        return false;
    }
  }

  if (*parser->cursor != '"') return false;
  parser->cursor += 1;
  if (output) output[length] = '\0';
  if (written) *written = length;
  return true;
}

static bool skip_value(JsonParser *parser);

static bool skip_array(JsonParser *parser) {
  if (*parser->cursor++ != '[' || parser->depth >= 32) return false;
  parser->depth += 1;
  skip_whitespace(parser);
  if (*parser->cursor == ']') {
    parser->cursor += 1;
    parser->depth -= 1;
    return true;
  }
  for (;;) {
    if (!skip_value(parser)) return false;
    skip_whitespace(parser);
    if (*parser->cursor == ']') {
      parser->cursor += 1;
      parser->depth -= 1;
      return true;
    }
    if (*parser->cursor++ != ',') return false;
    skip_whitespace(parser);
  }
}

static bool skip_object(JsonParser *parser) {
  if (*parser->cursor++ != '{' || parser->depth >= 32) return false;
  parser->depth += 1;
  skip_whitespace(parser);
  if (*parser->cursor == '}') {
    parser->cursor += 1;
    parser->depth -= 1;
    return true;
  }
  for (;;) {
    if (!parse_string(parser, NULL, 0, NULL)) return false;
    skip_whitespace(parser);
    if (*parser->cursor++ != ':') return false;
    skip_whitespace(parser);
    if (!skip_value(parser)) return false;
    skip_whitespace(parser);
    if (*parser->cursor == '}') {
      parser->cursor += 1;
      parser->depth -= 1;
      return true;
    }
    if (*parser->cursor++ != ',') return false;
    skip_whitespace(parser);
  }
}

static bool skip_number(JsonParser *parser) {
  const char *start = parser->cursor;
  if (*parser->cursor == '-') parser->cursor += 1;
  if (*parser->cursor == '0') {
    parser->cursor += 1;
  } else {
    if (!isdigit((unsigned char)*parser->cursor)) return false;
    while (isdigit((unsigned char)*parser->cursor)) parser->cursor += 1;
  }
  if (*parser->cursor == '.') {
    parser->cursor += 1;
    if (!isdigit((unsigned char)*parser->cursor)) return false;
    while (isdigit((unsigned char)*parser->cursor)) parser->cursor += 1;
  }
  if (*parser->cursor == 'e' || *parser->cursor == 'E') {
    parser->cursor += 1;
    if (*parser->cursor == '+' || *parser->cursor == '-') parser->cursor += 1;
    if (!isdigit((unsigned char)*parser->cursor)) return false;
    while (isdigit((unsigned char)*parser->cursor)) parser->cursor += 1;
  }
  return parser->cursor > start;
}

static bool consume_literal(JsonParser *parser, const char *literal) {
  size_t length = strlen(literal);
  if (strncmp(parser->cursor, literal, length) != 0) return false;
  parser->cursor += length;
  return true;
}

static bool skip_value(JsonParser *parser) {
  skip_whitespace(parser);
  switch (*parser->cursor) {
    case '"': return parse_string(parser, NULL, 0, NULL);
    case '{': return skip_object(parser);
    case '[': return skip_array(parser);
    case 't': return consume_literal(parser, "true");
    case 'f': return consume_literal(parser, "false");
    case 'n': return consume_literal(parser, "null");
    default: return skip_number(parser);
  }
}

bool pt_json_validate(const char *json) {
  JsonParser parser = { .cursor = json, .depth = 0 };
  if (!skip_value(&parser)) return false;
  skip_whitespace(&parser);
  return *parser.cursor == '\0';
}

static bool find_field(
  const char *json,
  const char *wanted,
  bool want_string,
  char *string_output,
  size_t string_capacity,
  int64_t *integer_output
) {
  JsonParser parser = { .cursor = json, .depth = 0 };
  skip_whitespace(&parser);
  if (*parser.cursor++ != '{') return false;
  skip_whitespace(&parser);
  unsigned matches = 0;
  bool found = false;

  if (*parser.cursor == '}') return false;
  for (;;) {
    char key[256];
    if (!parse_string(&parser, key, sizeof(key), NULL)) return false;
    skip_whitespace(&parser);
    if (*parser.cursor++ != ':') return false;
    skip_whitespace(&parser);

    if (strcmp(key, wanted) == 0) {
      matches += 1;
      if (matches > 1) return false;
      if (want_string) {
        if (!parse_string(&parser, string_output, string_capacity, NULL)) return false;
      } else {
        const char *start = parser.cursor;
        if (*parser.cursor == '-') parser.cursor += 1;
        if (!isdigit((unsigned char)*parser.cursor)) return false;
        while (isdigit((unsigned char)*parser.cursor)) parser.cursor += 1;
        if (*parser.cursor == '.' || *parser.cursor == 'e' || *parser.cursor == 'E') return false;
        errno = 0;
        char *end = NULL;
        long long value = strtoll(start, &end, 10);
        if (errno != 0 || end != parser.cursor) return false;
        *integer_output = (int64_t)value;
      }
      found = true;
    } else if (!skip_value(&parser)) {
      return false;
    }

    skip_whitespace(&parser);
    if (*parser.cursor == '}') {
      parser.cursor += 1;
      break;
    }
    if (*parser.cursor++ != ',') return false;
    skip_whitespace(&parser);
  }
  skip_whitespace(&parser);
  return found && matches == 1 && *parser.cursor == '\0';
}

bool pt_json_get_string(
  const char *json,
  const char *key,
  char *output,
  size_t capacity
) {
  return output && capacity > 0
    && find_field(json, key, true, output, capacity, NULL);
}

bool pt_json_get_i64(const char *json, const char *key, int64_t *output) {
  return output && find_field(json, key, false, NULL, 0, output);
}

bool pt_read_fd(int descriptor, char **output, size_t *length) {
  return pt_read_fd_limited(descriptor, output, length, PT_TEXT_LIMIT);
}

bool pt_read_fd_limited(
  int descriptor,
  char **output,
  size_t *length,
  size_t limit
) {
  size_t used = 0;
  size_t capacity = 4096;
  char *buffer = malloc(capacity + 1);
  if (!buffer) return false;

  for (;;) {
    if (used == capacity) {
      if (capacity >= limit) {
        free(buffer);
        errno = EFBIG;
        return false;
      }
      capacity *= 2;
      char *larger = realloc(buffer, capacity + 1);
      if (!larger) {
        free(buffer);
        return false;
      }
      buffer = larger;
    }
    ssize_t count = read(descriptor, buffer + used, capacity - used);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) {
      free(buffer);
      return false;
    }
    if (count == 0) break;
    used += (size_t)count;
  }
  buffer[used] = '\0';
  *output = buffer;
  if (length) *length = used;
  return true;
}

bool pt_read_file(const char *path, char **output, size_t *length) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return false;
  bool result = pt_read_fd(descriptor, output, length);
  int saved = errno;
  close(descriptor);
  errno = saved;
  return result;
}

static void write_all(int descriptor, const char *bytes, size_t length) {
  while (length > 0) {
    ssize_t count = write(descriptor, bytes, length);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return;
    bytes += count;
    length -= (size_t)count;
  }
}

void pt_write_json_string(int descriptor, const char *value) {
  write_all(descriptor, "\"", 1);
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor += 1) {
    char escaped[7];
    const char *text = NULL;
    size_t length = 0;
    switch (*cursor) {
      case '"': text = "\\\""; length = 2; break;
      case '\\': text = "\\\\"; length = 2; break;
      case '\b': text = "\\b"; length = 2; break;
      case '\f': text = "\\f"; length = 2; break;
      case '\n': text = "\\n"; length = 2; break;
      case '\r': text = "\\r"; length = 2; break;
      case '\t': text = "\\t"; length = 2; break;
      default:
        if (*cursor < 0x20) {
          snprintf(escaped, sizeof(escaped), "\\u%04x", *cursor);
          text = escaped;
          length = 6;
        } else {
          escaped[0] = (char)*cursor;
          text = escaped;
          length = 1;
        }
    }
    write_all(descriptor, text, length);
  }
  write_all(descriptor, "\"", 1);
}

bool pt_process_identity(
  pid_t process_id,
  char *executable,
  size_t executable_capacity,
  int64_t *start_seconds,
  int64_t *start_microseconds
) {
  if (process_id <= 0 || executable_capacity < PROC_PIDPATHINFO_MAXSIZE) return false;
  if (proc_pidpath(process_id, executable, (uint32_t)executable_capacity) <= 0) return false;

  struct proc_bsdinfo info;
  int count = proc_pidinfo(
    process_id,
    PROC_PIDTBSDINFO,
    0,
    &info,
    (int)sizeof(info)
  );
  if (count != (int)sizeof(info)) return false;
  *start_seconds = (int64_t)info.pbi_start_tvsec;
  *start_microseconds = (int64_t)info.pbi_start_tvusec;
  return true;
}

bool pt_process_is_same(
  pid_t process_id,
  int64_t start_seconds,
  int64_t start_microseconds
) {
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t actual_seconds = 0;
  int64_t actual_microseconds = 0;
  return pt_process_identity(
      process_id,
      executable,
      sizeof(executable),
      &actual_seconds,
      &actual_microseconds
    )
    && actual_seconds == start_seconds
    && actual_microseconds == start_microseconds;
}

bool pt_process_generation_ended(
  pid_t process_id,
  int64_t start_seconds,
  int64_t start_microseconds
) {
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  int64_t actual_seconds = 0;
  int64_t actual_microseconds = 0;
  if (pt_process_identity(
        process_id,
        executable,
        sizeof(executable),
        &actual_seconds,
        &actual_microseconds
      )) {
    return actual_seconds != start_seconds
      || actual_microseconds != start_microseconds;
  }
  errno = 0;
  return kill(process_id, 0) != 0 && errno == ESRCH;
}

static bool run_capture(
  const char *executable,
  char *const arguments[],
  char *output,
  size_t capacity
) {
  int descriptors[2];
  if (pipe(descriptors) != 0) return false;

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    close(descriptors[0]);
    close(descriptors[1]);
    return false;
  }
  posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDOUT_FILENO);
  posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDERR_FILENO);
  posix_spawn_file_actions_addclose(&actions, descriptors[0]);
  posix_spawn_file_actions_addclose(&actions, descriptors[1]);

  pid_t child = 0;
  int spawn_status = posix_spawn(&child, executable, &actions, NULL, arguments, environ);
  posix_spawn_file_actions_destroy(&actions);
  close(descriptors[1]);
  if (spawn_status != 0) {
    close(descriptors[0]);
    return false;
  }

  size_t used = 0;
  while (used + 1 < capacity) {
    ssize_t count = read(descriptors[0], output + used, capacity - used - 1);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) break;
    used += (size_t)count;
  }
  output[used] = '\0';
  close(descriptors[0]);

  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static bool first_semantic_version(const char *text, char *output, size_t capacity) {
  const char *cursor = text;
  while (isspace((unsigned char)*cursor)) cursor += 1;
  const char *start = cursor;
  for (size_t component = 0; component < 3; component += 1) {
    if (!isdigit((unsigned char)*cursor)) return false;
    while (isdigit((unsigned char)*cursor)) cursor += 1;
    if (component < 2) {
      if (*cursor != '.') return false;
      cursor += 1;
    }
  }
  size_t length = (size_t)(cursor - start);
  if (*cursor != '\0') {
    if (!isspace((unsigned char)*cursor)) return false;
    while (isspace((unsigned char)*cursor)) cursor += 1;
    if (*cursor != '\0') {
      static const char suffix[] = "(Claude Code)";
      size_t suffix_length = sizeof(suffix) - 1;
      if (strncmp(cursor, suffix, suffix_length) != 0) return false;
      cursor += suffix_length;
      while (isspace((unsigned char)*cursor)) cursor += 1;
      if (*cursor != '\0') return false;
    }
  }
  if (length >= capacity) return false;
  memcpy(output, start, length);
  output[length] = '\0';
  return true;
}

bool pt_executable_version(const char *executable, char *output, size_t capacity) {
  char captured[1024];
  char *arguments[] = { (char *)executable, "--version", NULL };
  return run_capture(executable, arguments, captured, sizeof(captured))
    && first_semantic_version(captured, output, capacity);
}

bool pt_sha256_file(const char *path, char output[65]) {
  char captured[256];
  char *arguments[] = { "/usr/bin/shasum", "-a", "256", (char *)path, NULL };
  if (!run_capture(arguments[0], arguments, captured, sizeof(captured))) return false;
  for (size_t index = 0; index < 64; index += 1) {
    if (!isxdigit((unsigned char)captured[index])) return false;
    output[index] = (char)tolower((unsigned char)captured[index]);
  }
  output[64] = '\0';
  return captured[64] == ' ' || captured[64] == '\t';
}

bool pt_is_safe_identifier(const char *value) {
  size_t length = strlen(value);
  if (length == 0 || length > 128) return false;
  for (size_t index = 0; index < length; index += 1) {
    unsigned char character = (unsigned char)value[index];
    if (!(isalnum(character) || character == '-' || character == '_')) return false;
  }
  return true;
}

void pt_random_uuid(char output[37]) {
  unsigned char bytes[16];
  arc4random_buf(bytes, sizeof(bytes));
  bytes[6] = (unsigned char)((bytes[6] & 0x0f) | 0x40);
  bytes[8] = (unsigned char)((bytes[8] & 0x3f) | 0x80);
  snprintf(
    output,
    37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0], bytes[1], bytes[2], bytes[3],
    bytes[4], bytes[5], bytes[6], bytes[7],
    bytes[8], bytes[9], bytes[10], bytes[11],
    bytes[12], bytes[13], bytes[14], bytes[15]
  );
}

bool pt_has_extended_acl(const char *path) {
  acl_t access = acl_get_link_np(path, ACL_TYPE_EXTENDED);
  if (!access) return errno != ENOENT;
  acl_free(access);
  return true;
}

bool pt_has_write_grant_acl(const char *path) {
  acl_t access = acl_get_link_np(path, ACL_TYPE_EXTENDED);
  if (!access) return errno != ENOENT;

  const acl_perm_t write_permissions[] = {
    ACL_WRITE_DATA,
    ACL_DELETE,
    ACL_APPEND_DATA,
    ACL_DELETE_CHILD,
    ACL_WRITE_ATTRIBUTES,
    ACL_WRITE_EXTATTRIBUTES,
    ACL_WRITE_SECURITY,
    ACL_CHANGE_OWNER,
  };
  acl_entry_t entry;
  int entry_id = ACL_FIRST_ENTRY;
  while (acl_get_entry(access, entry_id, &entry) == 0) {
    entry_id = ACL_NEXT_ENTRY;
    acl_tag_t tag;
    acl_permset_t permissions;
    if (acl_get_tag_type(entry, &tag) != 0
        || acl_get_permset(entry, &permissions) != 0) {
      acl_free(access);
      return true;
    }
    if (tag != ACL_EXTENDED_ALLOW) continue;
    for (size_t index = 0;
         index < sizeof(write_permissions) / sizeof(write_permissions[0]);
         index += 1) {
      if (acl_get_perm_np(permissions, write_permissions[index]) == 1) {
        acl_free(access);
        return true;
      }
    }
  }
  acl_free(access);
  return false;
}

static bool secure_path(const char *path, mode_t type, mode_t permissions) {
  struct stat status;
  if (lstat(path, &status) != 0) return false;
  if ((status.st_mode & S_IFMT) != type || status.st_uid != geteuid()) return false;
  if ((status.st_mode & 0777) != permissions) return false;
  return !pt_has_extended_acl(path);
}

bool pt_read_locator(
  const char *directory,
  const char *name,
  PtLocatorIdentity *identity,
  char **text
) {
  *text = NULL;
  size_t name_length = strlen(name);
  if (name_length <= 5 || strcmp(name + name_length - 5, ".json") != 0) {
    return false;
  }
  int length = snprintf(identity->path, sizeof(identity->path), "%s/%s", directory, name);
  if (length < 0 || (size_t)length >= sizeof(identity->path)
      || !pt_path_is_private_file(identity->path)) {
    return false;
  }
  char *locator = NULL;
  bool valid = pt_read_file(identity->path, &locator, NULL)
    && pt_json_validate(locator)
    && pt_json_get_string(locator, "sessionId", identity->session_id, sizeof(identity->session_id))
    && pt_json_get_i64(locator, "hostPid", &identity->host_pid)
    && pt_json_get_i64(locator, "hostStartSeconds", &identity->host_start_seconds)
    && pt_json_get_i64(locator, "hostStartMicroseconds", &identity->host_start_microseconds)
    && identity->host_pid > 0
    && identity->host_pid <= INT_MAX
    && pt_is_safe_identifier(identity->session_id);
  if (valid) {
    char expected[PATH_MAX];
    valid = (pt_locator_file_name(
          identity->session_id,
          identity->host_pid,
          identity->host_start_seconds,
          identity->host_start_microseconds,
          expected,
          sizeof(expected)
        )
        && strcmp(expected, name) == 0);
    if (!valid) {
      length = snprintf(expected, sizeof(expected), "%s.json", identity->session_id);
      valid = length >= 0 && (size_t)length < sizeof(expected) && strcmp(expected, name) == 0;
    }
  }
  if (!valid) {
    free(locator);
    return false;
  }
  *text = locator;
  return true;
}

bool pt_path_is_private_directory(const char *path) {
  return secure_path(path, S_IFDIR, 0700);
}

bool pt_path_is_private_file(const char *path) {
  return secure_path(path, S_IFREG, 0600);
}

bool pt_ensure_private_directory(const char *path) {
  struct stat status;
  if (lstat(path, &status) != 0) {
    if (errno != ENOENT || mkdir(path, 0700) != 0) return false;
    return pt_path_is_private_directory(path);
  }
  if (!S_ISDIR(status.st_mode) || status.st_uid != geteuid() || pt_has_extended_acl(path)) {
    return false;
  }
  if ((status.st_mode & 0777) != 0700 && chmod(path, 0700) != 0) return false;
  return pt_path_is_private_directory(path);
}

bool pt_locator_file_name(
  const char *session_id,
  int64_t host_pid,
  int64_t host_start_seconds,
  int64_t host_start_microseconds,
  char *output,
  size_t capacity
) {
  int length = snprintf(
    output,
    capacity,
    "%s.%lld-%lld-%lld.json",
    session_id,
    (long long)host_pid,
    (long long)host_start_seconds,
    (long long)host_start_microseconds
  );
  return length >= 0 && (size_t)length < capacity;
}

// THROWAWAY PROTOTYPE. This helper exists only to answer the SQLite boundary ticket.
#define _DARWIN_C_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <sqlite3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define SCHEMA_VERSION 2
#define LOCATOR_NAME "prompt-trail-sqlite-probe.json"

static void fail(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static void fail_errno(const char *message) {
  fprintf(stderr, "%s: %s\n", message, strerror(errno));
  exit(1);
}

static void fail_sqlite(sqlite3 *db, const char *message) {
  fprintf(stderr, "%s: %s\n", message, sqlite3_errmsg(db));
  sqlite3_close(db);
  exit(1);
}

static void exec_sql(sqlite3 *db, const char *sql) {
  char *error = NULL;
  if (sqlite3_exec(db, sql, NULL, NULL, &error) != SQLITE_OK) {
    fprintf(stderr, "SQLite statement failed: %s\n", error ? error : "unknown error");
    sqlite3_free(error);
    sqlite3_close(db);
    exit(1);
  }
}

static void mkdir_parents(const char *directory) {
  char path[PATH_MAX];
  size_t length = strlen(directory);
  if (length == 0 || length >= sizeof(path)) fail("Directory path is invalid");
  memcpy(path, directory, length + 1);

  for (char *cursor = path + 1; *cursor; cursor++) {
    if (*cursor != '/') continue;
    *cursor = '\0';
    if (mkdir(path, 0700) != 0 && errno != EEXIST) fail_errno("Cannot create directory");
    *cursor = '/';
  }
  if (mkdir(path, 0700) != 0 && errno != EEXIST) fail_errno("Cannot create directory");
}

static void parent_directory(const char *path, char output[PATH_MAX]) {
  size_t length = strlen(path);
  if (length == 0 || length >= PATH_MAX) fail("Path is invalid");
  memcpy(output, path, length + 1);
  char *slash = strrchr(output, '/');
  if (!slash) {
    strcpy(output, ".");
  } else if (slash == output) {
    slash[1] = '\0';
  } else {
    *slash = '\0';
  }
}

static char *canonical_root(const char *root) {
  char resolved[PATH_MAX];
  if (!realpath(root, resolved)) fail_errno("Cannot canonicalize project root");
  return strdup(resolved);
}

static uint64_t fnv1a(const unsigned char *bytes, size_t length) {
  uint64_t hash = UINT64_C(14695981039346656037);
  for (size_t index = 0; index < length; index++) {
    hash ^= bytes[index];
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static void stable_id(const char *prefix, const char *value, char output[32]) {
  uint64_t hash = fnv1a((const unsigned char *)value, strlen(value));
  snprintf(output, 32, "%s-%016llx", prefix, (unsigned long long)hash);
}

static char *read_stdin(void) {
  size_t used = 0;
  size_t capacity = 4096;
  char *buffer = malloc(capacity);
  if (!buffer) fail("Out of memory");

  for (;;) {
    if (used == capacity) {
      capacity *= 2;
      char *larger = realloc(buffer, capacity);
      if (!larger) {
        free(buffer);
        fail("Out of memory");
      }
      buffer = larger;
    }
    size_t count = fread(buffer + used, 1, capacity - used, stdin);
    used += count;
    if (count == 0) {
      if (ferror(stdin)) {
        free(buffer);
        fail("Cannot read stdin");
      }
      break;
    }
  }

  char *terminated = realloc(buffer, used + 1);
  if (!terminated) {
    free(buffer);
    fail("Out of memory");
  }
  terminated[used] = '\0';
  return terminated;
}

static void json_string(FILE *stream, const char *value) {
  fputc('"', stream);
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) {
    switch (*cursor) {
      case '"': fputs("\\\"", stream); break;
      case '\\': fputs("\\\\", stream); break;
      case '\b': fputs("\\b", stream); break;
      case '\f': fputs("\\f", stream); break;
      case '\n': fputs("\\n", stream); break;
      case '\r': fputs("\\r", stream); break;
      case '\t': fputs("\\t", stream); break;
      default:
        if (*cursor < 0x20) fprintf(stream, "\\u%04x", *cursor);
        else fputc(*cursor, stream);
    }
  }
  fputc('"', stream);
}

static void bind_text(sqlite3 *db, sqlite3_stmt *statement, int index, const char *value) {
  int result = value
    ? sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
    : sqlite3_bind_null(statement, index);
  if (result != SQLITE_OK) fail_sqlite(db, "Cannot bind SQLite value");
}

static sqlite3_stmt *prepare(sqlite3 *db, const char *sql) {
  sqlite3_stmt *statement = NULL;
  if (sqlite3_prepare_v2(db, sql, -1, &statement, NULL) != SQLITE_OK) {
    fail_sqlite(db, "Cannot prepare SQLite statement");
  }
  return statement;
}

static void migrate(sqlite3 *db) {
  int version = 0;
  sqlite3_stmt *version_statement = prepare(db, "PRAGMA user_version");
  if (sqlite3_step(version_statement) == SQLITE_ROW) {
    version = sqlite3_column_int(version_statement, 0);
  }
  sqlite3_finalize(version_statement);

  if (version > SCHEMA_VERSION) fail_sqlite(db, "Database schema is newer than this helper");

  if (version == 0) {
    exec_sql(db,
      "BEGIN IMMEDIATE;"
      "CREATE TABLE projects("
      " project_id TEXT PRIMARY KEY,"
      " canonical_root TEXT NOT NULL UNIQUE,"
      " next_sequence INTEGER NOT NULL DEFAULT 0"
      ");"
      "CREATE TABLE events("
      " event_id TEXT PRIMARY KEY,"
      " project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,"
      " sequence INTEGER NOT NULL,"
      " run_id TEXT NOT NULL,"
      " segment_id TEXT NOT NULL,"
      " branch_id TEXT NOT NULL,"
      " parent_event_id TEXT,"
      " kind TEXT NOT NULL,"
      " occurred_at TEXT NOT NULL,"
      " prompt_text TEXT,"
      " text_hash TEXT NOT NULL,"
      " UNIQUE(project_id, sequence)"
      ");"
      "CREATE INDEX events_project_sequence ON events(project_id, sequence);"
      "CREATE INDEX events_project_run ON events(project_id, run_id, sequence);"
      "PRAGMA user_version=2;"
      "COMMIT;"
    );
    return;
  }

  if (version == 1) {
    exec_sql(db,
      "BEGIN IMMEDIATE;"
      "ALTER TABLE events ADD COLUMN text_hash TEXT NOT NULL DEFAULT '';"
      "PRAGMA user_version=2;"
      "COMMIT;"
    );
  }
}

static sqlite3 *open_database(const char *database_path) {
  char directory[PATH_MAX];
  parent_directory(database_path, directory);
  mode_t previous_umask = umask(0077);
  mkdir_parents(directory);
  chmod(directory, 0700);

  sqlite3 *db = NULL;
  int result = sqlite3_open_v2(
    database_path,
    &db,
    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
    NULL
  );
  umask(previous_umask);
  if (result != SQLITE_OK) fail_sqlite(db, "Cannot open SQLite database");
  chmod(database_path, 0600);

  sqlite3_busy_timeout(db, 10000);
  exec_sql(db, "PRAGMA journal_mode=WAL");
  exec_sql(db, "PRAGMA synchronous=FULL");
  exec_sql(db, "PRAGMA foreign_keys=ON");
  exec_sql(db, "PRAGMA secure_delete=ON");
  migrate(db);
  return db;
}

static void ensure_project(sqlite3 *db, const char *project_id, const char *root) {
  sqlite3_stmt *insert = prepare(db,
    "INSERT INTO projects(project_id, canonical_root, next_sequence) VALUES(?1, ?2, 0) "
    "ON CONFLICT(canonical_root) DO NOTHING"
  );
  bind_text(db, insert, 1, project_id);
  bind_text(db, insert, 2, root);
  if (sqlite3_step(insert) != SQLITE_DONE) fail_sqlite(db, "Cannot create project row");
  sqlite3_finalize(insert);

  sqlite3_stmt *check = prepare(db,
    "SELECT canonical_root FROM projects WHERE project_id=?1"
  );
  bind_text(db, check, 1, project_id);
  if (sqlite3_step(check) != SQLITE_ROW) fail_sqlite(db, "Project hash collision");
  const char *stored = (const char *)sqlite3_column_text(check, 0);
  if (!stored || strcmp(stored, root) != 0) fail_sqlite(db, "Project hash collision");
  sqlite3_finalize(check);
}

static long long find_existing_sequence(sqlite3 *db, const char *event_id, const char *project_id) {
  sqlite3_stmt *statement = prepare(db,
    "SELECT sequence FROM events WHERE event_id=?1 AND project_id=?2"
  );
  bind_text(db, statement, 1, event_id);
  bind_text(db, statement, 2, project_id);
  int result = sqlite3_step(statement);
  long long sequence = result == SQLITE_ROW ? sqlite3_column_int64(statement, 0) : 0;
  sqlite3_finalize(statement);
  return sequence;
}

static void command_bridge_publish(const char *database_path, const char *helper_argument) {
  const char *home = getenv("HOME");
  if (!home || home[0] != '/') fail("HOME must be an absolute path");

  char helper_path[PATH_MAX];
  if (!realpath(helper_argument, helper_path)) fail_errno("Cannot canonicalize helper path");

  char locator_directory[PATH_MAX];
  char locator_path[PATH_MAX];
  char temporary_path[PATH_MAX];
  snprintf(locator_directory, sizeof(locator_directory),
    "%s/.claude/plugins/data/.function-hook-locators", home);
  snprintf(locator_path, sizeof(locator_path), "%s/%s", locator_directory, LOCATOR_NAME);
  snprintf(temporary_path, sizeof(temporary_path), "%s.tmp.%ld", locator_path, (long)getpid());

  mode_t previous_umask = umask(0077);
  mkdir_parents(locator_directory);
  chmod(locator_directory, 0700);

  char database_directory[PATH_MAX];
  parent_directory(database_path, database_directory);
  mkdir_parents(database_directory);
  chmod(database_directory, 0700);

  FILE *file = fopen(temporary_path, "w");
  if (!file) fail_errno("Cannot create bridge locator");
  fputs("{\"version\":1,\"helper\":", file);
  json_string(file, helper_path);
  fputs(",\"database\":", file);
  json_string(file, database_path);
  fputs("}\n", file);
  if (fflush(file) != 0 || fsync(fileno(file)) != 0 || fclose(file) != 0) {
    unlink(temporary_path);
    fail_errno("Cannot flush bridge locator");
  }
  chmod(temporary_path, 0600);
  if (rename(temporary_path, locator_path) != 0) {
    unlink(temporary_path);
    fail_errno("Cannot publish bridge locator");
  }
  umask(previous_umask);

  printf("{\"locator\":");
  json_string(stdout, locator_path);
  printf(",\"database\":");
  json_string(stdout, database_path);
  printf("}\n");
}

static void command_append(int argc, char **argv) {
  if (argc != 12) {
    fail("append requires: db root event run segment branch parent kind occurred-at");
  }
  const char *database_path = argv[2];
  char *root = canonical_root(argv[3]);
  const char *event_id = argv[4];
  const char *run_id = argv[5];
  const char *segment_id = argv[6];
  const char *branch_id = argv[7];
  const char *parent_event_id = strcmp(argv[8], "-") == 0 ? NULL : argv[8];
  const char *kind = argv[9];
  const char *occurred_at = argv[10];
  const char *expected_token = argv[11];
  if (strcmp(expected_token, "--stdin") != 0) fail("append prompt text must use --stdin");
  char *prompt_text = read_stdin();

  char project_id[32];
  char text_hash[32];
  stable_id("p", root, project_id);
  stable_id("t", prompt_text, text_hash);

  sqlite3 *db = open_database(database_path);
  exec_sql(db, "BEGIN IMMEDIATE");
  ensure_project(db, project_id, root);

  long long existing = find_existing_sequence(db, event_id, project_id);
  if (existing > 0) {
    exec_sql(db, "COMMIT");
    printf("{\"eventId\":"); json_string(stdout, event_id);
    printf(",\"projectId\":"); json_string(stdout, project_id);
    printf(",\"sequence\":%lld,\"duplicate\":true}\n", existing);
    sqlite3_close(db);
    free(root);
    free(prompt_text);
    return;
  }

  sqlite3_stmt *next = prepare(db,
    "UPDATE projects SET next_sequence=next_sequence+1 WHERE project_id=?1 "
    "RETURNING next_sequence"
  );
  bind_text(db, next, 1, project_id);
  if (sqlite3_step(next) != SQLITE_ROW) fail_sqlite(db, "Cannot allocate sequence");
  long long sequence = sqlite3_column_int64(next, 0);
  sqlite3_finalize(next);

  sqlite3_stmt *insert = prepare(db,
    "INSERT INTO events("
    " event_id, project_id, sequence, run_id, segment_id, branch_id,"
    " parent_event_id, kind, occurred_at, prompt_text, text_hash"
    ") VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
  );
  bind_text(db, insert, 1, event_id);
  bind_text(db, insert, 2, project_id);
  sqlite3_bind_int64(insert, 3, sequence);
  bind_text(db, insert, 4, run_id);
  bind_text(db, insert, 5, segment_id);
  bind_text(db, insert, 6, branch_id);
  bind_text(db, insert, 7, parent_event_id);
  bind_text(db, insert, 8, kind);
  bind_text(db, insert, 9, occurred_at);
  bind_text(db, insert, 10, prompt_text);
  bind_text(db, insert, 11, text_hash);
  if (sqlite3_step(insert) != SQLITE_DONE) fail_sqlite(db, "Cannot insert event");
  sqlite3_finalize(insert);
  exec_sql(db, "COMMIT");

  printf("{\"eventId\":"); json_string(stdout, event_id);
  printf(",\"projectId\":"); json_string(stdout, project_id);
  printf(",\"sequence\":%lld,\"duplicate\":false}\n", sequence);
  sqlite3_close(db);
  free(root);
  free(prompt_text);
}

static void command_range(int argc, char **argv) {
  if (argc != 6) fail("range requires: db root after-sequence limit");
  char *root = canonical_root(argv[3]);
  char project_id[32];
  stable_id("p", root, project_id);
  long long after = strtoll(argv[4], NULL, 10);
  int limit = atoi(argv[5]);
  if (limit < 1 || limit > 10000) fail("range limit must be between 1 and 10000");

  sqlite3 *db = open_database(argv[2]);
  sqlite3_stmt *statement = prepare(db,
    "SELECT event_id, sequence, run_id, segment_id, branch_id, parent_event_id,"
    " kind, occurred_at, prompt_text, text_hash"
    " FROM events WHERE project_id=?1 AND sequence>?2"
    " ORDER BY sequence LIMIT ?3"
  );
  bind_text(db, statement, 1, project_id);
  sqlite3_bind_int64(statement, 2, after);
  sqlite3_bind_int(statement, 3, limit);

  while (sqlite3_step(statement) == SQLITE_ROW) {
    printf("{\"eventId\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 0));
    printf(",\"sequence\":%lld,\"runId\":", sqlite3_column_int64(statement, 1));
    json_string(stdout, (const char *)sqlite3_column_text(statement, 2));
    printf(",\"segmentId\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 3));
    printf(",\"branchId\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 4));
    printf(",\"parentEventId\":");
    if (sqlite3_column_type(statement, 5) == SQLITE_NULL) fputs("null", stdout);
    else json_string(stdout, (const char *)sqlite3_column_text(statement, 5));
    printf(",\"kind\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 6));
    printf(",\"occurredAt\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 7));
    printf(",\"promptText\":");
    if (sqlite3_column_type(statement, 8) == SQLITE_NULL) fputs("null", stdout);
    else json_string(stdout, (const char *)sqlite3_column_text(statement, 8));
    printf(",\"textHash\":"); json_string(stdout, (const char *)sqlite3_column_text(statement, 9));
    puts("}");
  }
  sqlite3_finalize(statement);
  sqlite3_close(db);
  free(root);
}

static void checkpoint(sqlite3 *db) {
  sqlite3_stmt *statement = prepare(db, "PRAGMA wal_checkpoint(TRUNCATE)");
  while (sqlite3_step(statement) == SQLITE_ROW) {}
  sqlite3_finalize(statement);
}

static void command_delete_run(int argc, char **argv) {
  if (argc != 5) fail("delete-run requires: db root run-id");
  char *root = canonical_root(argv[3]);
  char project_id[32];
  stable_id("p", root, project_id);
  sqlite3 *db = open_database(argv[2]);
  exec_sql(db, "BEGIN IMMEDIATE");
  sqlite3_stmt *statement = prepare(db,
    "DELETE FROM events WHERE project_id=?1 AND run_id=?2"
  );
  bind_text(db, statement, 1, project_id);
  bind_text(db, statement, 2, argv[4]);
  if (sqlite3_step(statement) != SQLITE_DONE) fail_sqlite(db, "Cannot delete run");
  int deleted = sqlite3_changes(db);
  sqlite3_finalize(statement);
  exec_sql(db, "COMMIT");
  checkpoint(db);
  printf("{\"deleted\":%d}\n", deleted);
  sqlite3_close(db);
  free(root);
}

static void command_delete_project(int argc, char **argv) {
  if (argc != 4) fail("delete-project requires: db root");
  char *root = canonical_root(argv[3]);
  char project_id[32];
  stable_id("p", root, project_id);
  sqlite3 *db = open_database(argv[2]);
  exec_sql(db, "BEGIN EXCLUSIVE");
  sqlite3_stmt *statement = prepare(db, "DELETE FROM projects WHERE project_id=?1");
  bind_text(db, statement, 1, project_id);
  if (sqlite3_step(statement) != SQLITE_DONE) fail_sqlite(db, "Cannot delete project");
  int deleted = sqlite3_changes(db);
  sqlite3_finalize(statement);
  exec_sql(db, "COMMIT");
  checkpoint(db);
  exec_sql(db, "VACUUM");
  printf("{\"deletedProjects\":%d}\n", deleted);
  sqlite3_close(db);
  free(root);
}

static void command_inspect(int argc, char **argv) {
  if (argc != 4) fail("inspect requires: db root");
  char *root = canonical_root(argv[3]);
  char project_id[32];
  stable_id("p", root, project_id);
  sqlite3 *db = open_database(argv[2]);
  sqlite3_stmt *statement = prepare(db,
    "SELECT COUNT(*), COALESCE(MIN(sequence), 0), COALESCE(MAX(sequence), 0)"
    " FROM events WHERE project_id=?1"
  );
  bind_text(db, statement, 1, project_id);
  if (sqlite3_step(statement) != SQLITE_ROW) fail_sqlite(db, "Cannot inspect project");
  long long count = sqlite3_column_int64(statement, 0);
  long long minimum = sqlite3_column_int64(statement, 1);
  long long maximum = sqlite3_column_int64(statement, 2);
  sqlite3_finalize(statement);

  sqlite3_stmt *integrity = prepare(db, "PRAGMA integrity_check");
  const char *integrity_text = "missing";
  if (sqlite3_step(integrity) == SQLITE_ROW) {
    integrity_text = (const char *)sqlite3_column_text(integrity, 0);
  }
  printf("{\"schemaVersion\":%d,\"journalMode\":\"wal\",\"secureDelete\":true,", SCHEMA_VERSION);
  printf("\"projectId\":"); json_string(stdout, project_id);
  printf(",\"canonicalRoot\":"); json_string(stdout, root);
  printf(",\"count\":%lld,\"minSequence\":%lld,\"maxSequence\":%lld,\"integrity\":", count, minimum, maximum);
  json_string(stdout, integrity_text);
  puts("}");
  sqlite3_finalize(integrity);
  sqlite3_close(db);
  free(root);
}

static void command_crash(int argc, char **argv) {
  if (argc != 6) fail("crash requires: db root event-id marker-text");
  char *root = canonical_root(argv[3]);
  char project_id[32];
  stable_id("p", root, project_id);
  sqlite3 *db = open_database(argv[2]);
  exec_sql(db, "BEGIN IMMEDIATE");
  ensure_project(db, project_id, root);

  sqlite3_stmt *next = prepare(db,
    "UPDATE projects SET next_sequence=next_sequence+1 WHERE project_id=?1 RETURNING next_sequence"
  );
  bind_text(db, next, 1, project_id);
  if (sqlite3_step(next) != SQLITE_ROW) fail_sqlite(db, "Cannot allocate crash sequence");
  long long sequence = sqlite3_column_int64(next, 0);
  sqlite3_finalize(next);

  sqlite3_stmt *insert = prepare(db,
    "INSERT INTO events(event_id, project_id, sequence, run_id, segment_id, branch_id,"
    " kind, occurred_at, prompt_text, text_hash)"
    " VALUES(?1, ?2, ?3, 'crash-run', 'segment', 'branch', 'prompt',"
    " '1970-01-01T00:00:00Z', ?4, 'crash-hash')"
  );
  bind_text(db, insert, 1, argv[4]);
  bind_text(db, insert, 2, project_id);
  sqlite3_bind_int64(insert, 3, sequence);
  bind_text(db, insert, 4, argv[5]);
  if (sqlite3_step(insert) != SQLITE_DONE) fail_sqlite(db, "Cannot insert crash event");
  sqlite3_finalize(insert);
  (void)db;
  free(root);
  _exit(86);
}

static void usage(void) {
  fputs(
    "Usage:\n"
    "  helper bridge-publish <database> <helper-path>\n"
    "  helper append <database> <root> <event> <run> <segment> <branch> <parent|-> <kind> <occurred-at> --stdin\n"
    "  helper range <database> <root> <after-sequence> <limit>\n"
    "  helper inspect <database> <root>\n"
    "  helper delete-run <database> <root> <run>\n"
    "  helper delete-project <database> <root>\n"
    "  helper crash <database> <root> <event> <marker-text>\n",
    stderr
  );
  exit(2);
}

int main(int argc, char **argv) {
  if (argc < 2) usage();
  if (strcmp(argv[1], "bridge-publish") == 0) {
    if (argc != 4) usage();
    command_bridge_publish(argv[2], argv[3]);
  } else if (strcmp(argv[1], "append") == 0) {
    command_append(argc, argv);
  } else if (strcmp(argv[1], "range") == 0) {
    command_range(argc, argv);
  } else if (strcmp(argv[1], "inspect") == 0) {
    command_inspect(argc, argv);
  } else if (strcmp(argv[1], "delete-run") == 0) {
    command_delete_run(argc, argv);
  } else if (strcmp(argv[1], "delete-project") == 0) {
    command_delete_project(argc, argv);
  } else if (strcmp(argv[1], "crash") == 0) {
    command_crash(argc, argv);
  } else {
    usage();
  }
  return 0;
}

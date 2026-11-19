// Lecture hors ligne du format SQL texte de pg_dump. Aucune instruction SQL n'est exécutée.
const identifier = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`;
const qualified = `(${identifier})\\s*\\.\\s*(${identifier})`;
const copyHeader = new RegExp(
  `^COPY\\s+${qualified}\\s*\\(([\\s\\S]+)\\)\\s+FROM\\s+stdin$`, "i",
);
const columnName = new RegExp(`^${identifier}$`, "i");
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function identifierName(value) {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase();
}

function isComment(token) {
  return token.startsWith("--") || token.startsWith("/*");
}

// Les citations SQL et les commentaires peuvent contenir des points-virgules,
// des virgules ou l'apparence d'une déclaration de table.
function tokenEnd(sql, start, token) {
  if (token.startsWith("--")) return start + token.length;

  if (token === "/*") {
    const markers = /\/\*|\*\//g;
    markers.lastIndex = start + 2;
    let nesting = 1;
    for (const marker of sql.matchAll(markers)) {
      nesting += marker[0] === "/*" ? 1 : -1;
      if (nesting === 0) return marker.index + 2;
    }
  } else if (token.startsWith("$")) {
    const end = sql.indexOf(token, start + token.length);
    if (end !== -1) return end + token.length;
  } else {
    const quote = token.at(-1);
    for (let index = start + token.length; index < sql.length; index++) {
      if (token.length === 2 && sql[index] === "\\") {
        index++;
      } else if (sql[index] === quote) {
        if (sql[index + 1] !== quote) return index + 1;
        index++;
      }
    }
  }

  throw new Error("unterminated_sql_token");
}

function scanSql(sql, offset, punctuation, flags = "g") {
  const markers = new RegExp(
    String.raw`--[^\r\n]*|/\*|\b[eE]'|'|"|(?<![a-zA-Z0-9_$])\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$|` + punctuation,
    flags,
  );
  markers.lastIndex = offset;
  return markers;
}

function nextStatement(sql, offset) {
  const directive = String.raw`\\(?:un)?restrict[ \t]+[a-zA-Z0-9]+[ \t]*(?=\r?\n|$)`;
  const markers = scanSql(sql, offset, `;|${directive}`);
  let content = "";
  let cursor = offset;
  let match;

  while ((match = markers.exec(sql))) {
    const token = match[0];
    content += sql.slice(cursor, match.index);
    if (token === ";") return { text: content.trim(), end: markers.lastIndex };
    if (token.startsWith("\\")) {
      if (content.trim()) throw new Error("invalid_psql_directive");
      cursor = markers.lastIndex;
    } else {
      cursor = tokenEnd(sql, match.index, token);
      content += isComment(token) ? " " : sql.slice(match.index, cursor);
    }
    markers.lastIndex = cursor;
  }

  const remaining = (content + sql.slice(cursor)).trim();
  if (remaining) throw new Error("unterminated_sql_statement");
  return { text: "", end: sql.length };
}

function* pgDumpStatements(sql) {
  let offset = 0;
  while (offset < sql.length) {
    const { text, end } = nextStatement(sql, offset);
    if (text) yield text;
    offset = end;
  }
}

function splitSqlList(sql) {
  const markers = scanSql(sql, 0, String.raw`[(),\[\]]`);
  const parts = [];
  let nesting = 0;
  let start = 0;
  let match;

  while ((match = markers.exec(sql))) {
    switch (match[0]) {
      case "(":
      case "[":
        nesting++;
        break;
      case ")":
      case "]":
        nesting--;
        break;
      case ",":
        if (nesting === 0) {
          parts.push(sql.slice(start, match.index).trim());
          start = markers.lastIndex;
        }
        break;
      default:
        markers.lastIndex = tokenEnd(sql, match.index, match[0]);
    }
    if (nesting < 0) throw new Error("unbalanced_sql_list");
  }

  if (nesting !== 0) throw new Error("unbalanced_sql_list");
  parts.push(sql.slice(start).trim());
  return parts;
}

function readSqlIdentifiers(list) {
  return splitSqlList(list).map((value) => {
    if (!columnName.test(value)) throw new Error("invalid_sql_identifier_list");
    return identifierName(value);
  });
}

const createTable = new RegExp(
  `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${qualified}\\s*\\(([\\s\\S]*)\\)$`, "i",
);
const tableConstraint = `(?:CONSTRAINT\\s+${identifier}\\s+)?`;
const primaryKey = `${tableConstraint}PRIMARY\\s+KEY\\s*\\(([^()]*)\\)`;
const tablePrimaryKey = new RegExp(`^${primaryKey}`, "i");
const alterPrimaryKey = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${qualified}\\s+ADD\\s+${primaryKey}`, "i",
);
const otherConstraint = new RegExp(
  `^${tableConstraint}(?:CHECK|UNIQUE|EXCLUDE|FOREIGN\\s+KEY)\\b`, "i",
);
const columnDefinition = new RegExp(`^(${identifier})\\s+([\\s\\S]+)$`, "i");

function containsKeywords(sql, keywords) {
  const markers = scanSql(sql, 0, `(${keywords})`, "gi");
  let match;
  while ((match = markers.exec(sql))) {
    if (match[1] !== undefined) return true;
    markers.lastIndex = tokenEnd(sql, match.index, match[0]);
  }
  return false;
}

export function readPublicDumpSchema(sql) {
  const tables = new Map();
  const keys = new Map();

  function setPrimaryKey(table, columns) {
    if (keys.has(table)) throw new Error("duplicate_primary_key");
    keys.set(table, columns);
  }

  for (const statement of pgDumpStatements(sql)) {
    const alteration = alterPrimaryKey.exec(statement);
    if (alteration && identifierName(alteration[1]) === "public") {
      setPrimaryKey(identifierName(alteration[2]), readSqlIdentifiers(alteration[3]));
      continue;
    }

    const create = createTable.exec(statement);
    if (!create || identifierName(create[1]) !== "public") continue;
    const table = identifierName(create[2]);
    if (tables.has(table)) throw new Error("duplicate_schema_table");
    const columns = new Set();
    const copyColumns = new Set();

    for (const definition of splitSqlList(create[3])) {
      const key = tablePrimaryKey.exec(definition);
      if (key) {
        setPrimaryKey(table, readSqlIdentifiers(key[1]));
        continue;
      }
      if (otherConstraint.test(definition)) continue;

      const column = columnDefinition.exec(definition);
      if (!column) throw new Error("invalid_column_definition");
      const name = identifierName(column[1]);
      if (columns.has(name)) throw new Error("duplicate_schema_column");
      columns.add(name);

      if (containsKeywords(column[2], String.raw`\bPRIMARY\s+KEY\b`)) {
        setPrimaryKey(table, [name]);
      }
      if (!containsKeywords(column[2], String.raw`\bGENERATED\s+ALWAYS\s+AS\s*\(`)) {
        copyColumns.add(name);
      }
    }
    tables.set(table, { columns, copyColumns });
  }

  for (const [name, table] of tables) table.primaryKey = keys.get(name) ?? [];
  return tables;
}

const controlEscapes = {
  b: 8, f: 12, n: 10, r: 13, t: 9, v: 11,
};

const dumpMetadata = /^(?:SET\s|RESET\s+ALL$|SELECT\s+pg_catalog\.(?:set_config|setval)\s*\(|ALTER\s+TABLE\b[\s\S]*\s(?:DISABLE|ENABLE)\s+TRIGGER\s+ALL$)/i;

function copyValue(field) {
  if (field === "\\N") return null;
  if (!field.includes("\\")) return field;

  const escapes = /\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|[^])/g;
  const bytes = [];
  let cursor = 0;
  for (const match of field.matchAll(escapes)) {
    const value = match[0].slice(1);
    bytes.push(Buffer.from(field.slice(cursor, match.index)));
    if (/^[0-7]{1,3}$/.test(value)) {
      bytes.push(Buffer.from([Number.parseInt(value, 8)]));
    } else if (value.length > 1 && value.startsWith("x")) {
      bytes.push(Buffer.from([Number.parseInt(value.slice(1), 16)]));
    } else {
      bytes.push(Object.hasOwn(controlEscapes, value)
        ? Buffer.from([controlEscapes[value]])
        : Buffer.from(value));
    }
    cursor = match.index + match[0].length;
  }
  const suffix = field.slice(cursor);
  if (suffix.includes("\\")) throw new Error("unterminated_copy_escape");
  bytes.push(Buffer.from(suffix));
  const result = Buffer.concat(bytes);
  if (result.includes(0)) throw new Error("nul_in_copy_value");
  return textDecoder.decode(result);
}

function readCopyRows(sql, end, block, onRow, onIssue) {
  const firstLine = /[ \t]*\r?\n/y;
  firstLine.lastIndex = end;
  if (!firstLine.exec(sql)) {
    onIssue("missing_copy_terminator");
    return sql.length;
  }

  let offset = firstLine.lastIndex;
  while (offset < sql.length) {
    const newline = sql.indexOf("\n", offset);
    const lineEnd = newline === -1 ? sql.length : newline;
    const line = sql.slice(offset, lineEnd).replace(/\r$/, "");
    offset = newline === -1 ? sql.length : newline + 1;

    if (line === "\\.") return offset;
    const fields = line.split("\t");
    if (fields.length !== block.columns.length) {
      onIssue("invalid_copy_row_width");
      continue;
    }

    let values;
    try {
      if (line.includes("\0")) throw new Error("nul_in_copy_value");
      values = fields.map(copyValue);
    } catch {
      onIssue("invalid_copy_value");
      continue;
    }
    onRow(block, values);
  }

  onIssue("missing_copy_terminator");
  return offset;
}

export function readPgCopy(sql, {
  onBlock = () => {},
  onRow = () => {},
  onIssue = (code) => { throw new Error(code); },
} = {}) {
  const seen = new Set();
  let offset = 0;

  while (offset < sql.length) {
    let statement;
    try {
      statement = nextStatement(sql, offset);
    } catch {
      onIssue("invalid_data_sql");
      return;
    }
    offset = statement.end;
    if (!statement.text) continue;

    const header = copyHeader.exec(statement.text);
    if (!header) {
      if (!dumpMetadata.test(statement.text)) onIssue("unsupported_data_statement");
      continue;
    }

    let columns;
    try {
      columns = readSqlIdentifiers(header[3]);
    } catch {
      onIssue("invalid_copy_columns");
      return;
    }
    if (new Set(columns).size !== columns.length) {
      onIssue("invalid_copy_columns");
      return;
    }

    const block = { schema: identifierName(header[1]), table: identifierName(header[2]), columns };
    const key = JSON.stringify([block.schema, block.table]);
    if (seen.has(key)) onIssue("duplicate_copy_block");
    seen.add(key);
    onBlock(block);
    offset = readCopyRows(sql, offset, block, onRow, onIssue);
  }
}

-- Ни авторов, ни IP, ни времени сервера: только то, что ввели в форму.
CREATE TABLE IF NOT EXISTS sessions (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,          -- когда курили (вводится руками)
  strain    TEXT NOT NULL,          -- сорт, свободный текст
  method    TEXT NOT NULL DEFAULT '',
  legendary INTEGER NOT NULL DEFAULT 0,
  scores    TEXT NOT NULL,          -- JSON {ключ шкалы: -5..5}
  banal     TEXT NOT NULL DEFAULT '',
  text      TEXT NOT NULL DEFAULT '',
  del_hash  TEXT NOT NULL           -- sha256 токена удаления, сам токен живёт только в браузере автора
);

-- Сорта, вписанные заранее, ещё без накурок. Ключ — название в нижнем регистре без лишних пробелов.
CREATE TABLE IF NOT EXISTS strains (
  key  TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

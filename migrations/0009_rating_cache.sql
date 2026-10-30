-- Cache Steam review summaries so we don't refetch them on every alert.

CREATE TABLE IF NOT EXISTS steam_ratings (
  app_id TEXT PRIMARY KEY,
  rating TEXT
);
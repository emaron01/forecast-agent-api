-- Add channel hierarchy levels.
INSERT INTO hierarchy_levels (level, label, description)
VALUES
  (6, 'Channel Executive', 'Sees Channel Hero and Dash Exec View'),
  (7, 'Channel Director', 'Sees Channel Hero and Dash Aligned to Sales Leader'),
  (8, 'Channel Rep', 'Sees Channel Dash No HERO')
ON CONFLICT (level) DO NOTHING;

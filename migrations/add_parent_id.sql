-- Add parent_id to tasks table for weekly subtask hierarchy
-- Parent weekly tasks can have child subtasks; completing all subtasks auto-completes the parent.
ALTER TABLE tasks ADD COLUMN parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE DEFAULT NULL;
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);

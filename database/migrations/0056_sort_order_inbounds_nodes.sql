-- Manual ordering of inbounds and nodes (drag and drop in the panel). Existing rows keep their current
-- order (by id); new rows are appended by a trigger so no application code path can forget to set it.
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE inbounds SET sort_order = id WHERE sort_order = 0;
UPDATE nodes SET sort_order = id WHERE sort_order = 0;

CREATE OR REPLACE FUNCTION set_inbounds_sort_order() RETURNS trigger AS $$
BEGIN
    IF NEW.sort_order = 0 THEN
        SELECT COALESCE(MAX(sort_order), 0) + 1 INTO NEW.sort_order FROM inbounds;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inbounds_sort_order ON inbounds;
CREATE TRIGGER trg_inbounds_sort_order BEFORE INSERT ON inbounds
    FOR EACH ROW EXECUTE FUNCTION set_inbounds_sort_order();

CREATE OR REPLACE FUNCTION set_nodes_sort_order() RETURNS trigger AS $$
BEGIN
    IF NEW.sort_order = 0 THEN
        SELECT COALESCE(MAX(sort_order), 0) + 1 INTO NEW.sort_order FROM nodes;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nodes_sort_order ON nodes;
CREATE TRIGGER trg_nodes_sort_order BEFORE INSERT ON nodes
    FOR EACH ROW EXECUTE FUNCTION set_nodes_sort_order();

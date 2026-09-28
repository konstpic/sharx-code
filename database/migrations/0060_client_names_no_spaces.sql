-- Client names are used as Xray/Telemt user keys and stat keys, so they must be a single token.
-- Spaces are no longer allowed: every existing name with whitespace is rewritten to the canonical form
-- (trimmed, each whitespace run replaced by one underscore) and every place that stores the name follows.
DO $$
DECLARE
    r RECORD;
    base TEXT;
    newname TEXT;
BEGIN
    FOR r IN SELECT id, user_id, name FROM client_entities WHERE name ~ '\s' ORDER BY id LOOP
        base := regexp_replace(btrim(r.name), '\s+', '_', 'g');
        IF base = '' THEN
            base := 'client_' || r.id;
        END IF;
        newname := base;
        WHILE EXISTS (SELECT 1 FROM client_entities WHERE user_id = r.user_id AND name = newname AND id <> r.id) LOOP
            newname := newname || '_' || r.id;
        END LOOP;

        UPDATE client_entities SET name = newname WHERE id = r.id;
        UPDATE client_traffics SET email = newname WHERE LOWER(email) = LOWER(r.name);
        UPDATE inbound_client_ips SET client_name = newname WHERE LOWER(client_name) = LOWER(r.name);
        -- Client keys embedded in inbound settings (WireGuard / AmneziaWG peers, Xray clients) and in Xray templates.
        UPDATE inbounds SET settings = REPLACE(settings, '"' || r.name || '"', '"' || newname || '"')
            WHERE position('"' || r.name || '"' IN settings) > 0;
        UPDATE settings SET value = REPLACE(value, '"' || r.name || '"', '"' || newname || '"')
            WHERE key = 'xrayTemplateConfig' AND position('"' || r.name || '"' IN value) > 0;
        UPDATE xray_core_config_profiles SET config_json = REPLACE(config_json, '"' || r.name || '"', '"' || newname || '"')
            WHERE position('"' || r.name || '"' IN config_json) > 0;
    END LOOP;
END $$;

-- Defensive re-check of the balancer_pools primary key and the hosts.{inbound,node,pool}_id
-- foreign keys introduced in 0058_bundles.sql. That migration only ever runs once per install
-- (schema_migrations marks it done the moment it succeeds), so an install that already completed
-- it before hitting the panel's DB export/import feature with pg_dump unavailable (see
-- exportDbViaGORM in web/service/server.go) can still lose these constraints afterwards: a
-- restore there wipes and recreates every table from the dump, and that dump never carried
-- primary keys, unique indexes or FKs to begin with. 0058 would not re-run to repair it, since it
-- is already recorded as applied. This migration is the same idempotent checks as 0058, kept as
-- its own version so it runs at least once for every install regardless of 0058's status.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'balancer_pools')
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
           WHERE c.conrelid = 'public.balancer_pools'::regclass
             AND c.contype IN ('p', 'u')
             AND cardinality(c.conkey) = 1
             AND a.attname = 'id'
       ) THEN
        RAISE NOTICE 'Repairing balancer_pools: missing primary key (restored from an incomplete dump)';
        ALTER TABLE balancer_pools ADD PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hosts') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_inbound_id_fkey') THEN
            ALTER TABLE hosts ADD CONSTRAINT hosts_inbound_id_fkey FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_node_id_fkey') THEN
            ALTER TABLE hosts ADD CONSTRAINT hosts_node_id_fkey FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_pool_id_fkey') THEN
            ALTER TABLE hosts ADD CONSTRAINT hosts_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES balancer_pools(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

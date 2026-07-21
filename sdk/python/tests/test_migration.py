import unittest
import os
import tempfile
import json
from alp_sdk.migration import (
    MigrationEngine,
    UpgradeManifest,
    MigrationRecord,
    MigrationStatus,
    UpgradeStrategy,
)


class TestMigrationEngine(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine = MigrationEngine(checkpoint_dir=self.tmpdir)

    def test_register_migration(self):
        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
        )
        migration_id = self.engine.register_migration(manifest)
        self.assertIsNotNone(migration_id)
        self.assertEqual(len(migration_id), 16)

    def test_execute_dry_run(self):
        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.ROLLING,
            steps=[
                {"name": "backup", "type": "noop"},
                {"name": "migrate_schema", "type": "noop"},
            ],
        )
        record = self.engine.execute(manifest, dry_run=True)
        self.assertEqual(record.status, MigrationStatus.COMPLETED)
        self.assertIn("DRY RUN", record.logs[1])

    def test_execute_live_run(self):
        executed_steps = []

        def step_fn():
            executed_steps.append("step1")

        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.CANARY,
            steps=[
                {"name": "callback_step", "type": "callback", "fn": step_fn},
            ],
        )
        record = self.engine.execute(manifest)
        self.assertEqual(record.status, MigrationStatus.COMPLETED)
        self.assertEqual(len(executed_steps), 1)

    def test_execute_failure_triggers_rollback(self):
        rollback_called = []

        def bad_step():
            raise RuntimeError("simulated failure")

        def rollback_step():
            rollback_called.append(True)

        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BIG_BANG,
            steps=[
                {"name": "bad", "type": "callback", "fn": bad_step},
            ],
            rollback_steps=[
                {"name": "rollback", "type": "callback", "fn": rollback_step},
            ],
        )
        record = self.engine.execute(manifest)
        self.assertEqual(record.status, MigrationStatus.ROLLED_BACK)
        self.assertEqual(len(rollback_called), 1)

    def test_version_lock(self):
        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
        )
        self.engine.execute(manifest)
        lock = self.engine.get_version_lock("14.0.0")
        self.assertEqual(lock, "15.2.0")

    def test_list_migrations(self):
        m1 = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
        )
        m2 = UpgradeManifest(
            version_from="15.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.ROLLING,
        )
        self.engine.register_migration(m1)
        self.engine.register_migration(m2)
        records = self.engine.list_migrations()
        self.assertEqual(len(records), 2)

    def test_checkpoint_persistence(self):
        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
            steps=[{"name": "step1", "type": "noop"}],
        )
        migration_id = self.engine.register_migration(manifest)
        self.engine.execute(manifest)

        record = self.engine.get_status(migration_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.status, MigrationStatus.COMPLETED)

    def test_upgrade_manifest_id_stability(self):
        manifest = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
        )
        id1 = manifest._id
        manifest2 = UpgradeManifest(
            version_from="14.0.0",
            version_to="15.2.0",
            strategy=UpgradeStrategy.BLUE_GREEN,
        )
        id2 = manifest2._id
        self.assertEqual(id1, id2)


if __name__ == "__main__":
    unittest.main()

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletesData, splitUnifiedDiff } from '../lib/pr-rules.mjs';

const NEW_MIGRATION = [
  '@@ -0,0 +1,14 @@',
  '+<?php',
  '+return new class extends Migration {',
  '+    public function up(): void',
  '+    {',
  '+        Schema::create(\'examples\', function (Blueprint $table) {',
  '+            $table->id();',
  '+        });',
  '+    }',
  '+',
  '+    public function down(): void',
  '+    {',
  '+        Schema::dropIfExists(\'examples\');',
  '+    }',
  '+};',
].join('\n');

test('dropIfExists only in down() does not delete data', () => {
  assert.deepEqual(deletesData([{ path: 'database/migrations/2026_01_01_create_examples.php', patch: NEW_MIGRATION }]), { deleting: false, files: [] });
});

test('dropColumn in up() deletes data', () => {
  const patch = NEW_MIGRATION.replace("$table->id();", "$table->dropColumn('legacy');");
  const r = deletesData([{ path: 'database/migrations/2026_01_02_drop_legacy.php', patch }]);
  assert.deepEqual(r, { deleting: true, files: ['database/migrations/2026_01_02_drop_legacy.php'] });
});

test('a hunk without a visible function counts as up()', () => {
  const patch = '@@ -10,3 +10,4 @@\n         $x = 1;\n+        DB::table(\'examples\')->delete();\n     }';
  assert.equal(deletesData([{ path: 'database/migrations/x.php', patch }]).deleting, true);
});

test('context lines set the function', () => {
  const patch = '@@ -10,3 +10,4 @@\n     public function down(): void\n     {\n+        Schema::drop(\'examples\');\n     }';
  assert.equal(deletesData([{ path: 'database/migrations/x.php', patch }]).deleting, false);
});

test('only migrations count', () => {
  const patch = "@@ -1,1 +1,2 @@\n+$table->dropColumn('x');";
  assert.equal(deletesData([{ path: 'app/Models/Example.php', patch }]).deleting, false);
});

test('a migration without a patch counts as deleting', () => {
  assert.equal(deletesData([{ path: 'database/migrations/big.php', patch: null }]).deleting, true);
});

test('removed lines do not count', () => {
  const patch = "@@ -1,2 +1,1 @@\n-        $table->dropColumn('x');\n         $y = 2;";
  assert.equal(deletesData([{ path: 'database/migrations/x.php', patch }]).deleting, false);
});

test('splitUnifiedDiff', () => {
  const diff = [
    'diff --git a/database/migrations/a.php b/database/migrations/a.php',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/database/migrations/a.php',
    '@@ -0,0 +1,1 @@',
    '+x',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n');
  const files = splitUnifiedDiff(diff);
  assert.deepEqual(files.map((f) => f.path), ['database/migrations/a.php', 'README.md']);
  assert.equal(files[0].patch, '@@ -0,0 +1,1 @@\n+x');
});

test('splitUnifiedDiff takes the old path of a deleted file', () => {
  const diff = 'diff --git a/database/migrations/old.php b/database/migrations/old.php\ndeleted file mode 100644\n--- a/database/migrations/old.php\n+++ /dev/null\n@@ -1 +0,0 @@\n-x';
  assert.deepEqual(splitUnifiedDiff(diff).map((f) => f.path), ['database/migrations/old.php']);
});

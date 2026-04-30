const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

const files = [
  'apps/api/src/users/users.service.ts',
  'apps/api/src/swap/swap.service.ts',
  'apps/api/src/init-xlm-pool.ts',
  'apps/api/src/init-usdc-pool.ts',
  'apps/api/src/indexer/pool-indexer.service.ts',
  'apps/api/src/debug-merkle.ts',
  'apps/api/src/debug-deposit.ts',
  'apps/api/src/e2e-flow-test.e2e-spec.ts',
];

files.forEach((file) => {
  const filePath = path.join(repoRoot, file);
  if (!fs.existsSync(filePath)) {
    console.log('Skipping missing file: ' + filePath);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf-8');

  const needsReplacement =
    /process\.env\.(SHIELDED_POOL_ADDRESS|SHIELDED_POOL_XLM_ADDRESS|ZK_SWAP_ADDRESS|GROTH16_VERIFIER_ADDRESS)/.test(
      content,
    );

  if (needsReplacement) {
    let importPath = path
      .relative(path.dirname(filePath), path.join(repoRoot, 'apps/api/src/network.context'))
      .replace(/\\/g, '/');
    if (!importPath.startsWith('.')) importPath = './' + importPath;

    // Add import statement if not already there
    if (!content.includes('getContractAddress')) {
      // Find the last import statement and insert after it, or insert at top
      const lastImportMatch = [...content.matchAll(/^import .*;/gm)].pop();
      if (lastImportMatch) {
        const insertPos = lastImportMatch.index + lastImportMatch[0].length;
        content =
          content.slice(0, insertPos) +
          `\nimport { getContractAddress } from '${importPath}';` +
          content.slice(insertPos);
      } else {
        content = `import { getContractAddress } from '${importPath}';\n` + content;
      }
    }

    content = content.replace(
      /process\.env\.SHIELDED_POOL_ADDRESS/g,
      "getContractAddress('SHIELDED_POOL_ADDRESS')",
    );
    content = content.replace(
      /process\.env\.SHIELDED_POOL_XLM_ADDRESS/g,
      "getContractAddress('SHIELDED_POOL_XLM_ADDRESS')",
    );
    content = content.replace(
      /process\.env\.ZK_SWAP_ADDRESS/g,
      "getContractAddress('ZK_SWAP_ADDRESS')",
    );
    content = content.replace(
      /process\.env\.GROTH16_VERIFIER_ADDRESS/g,
      "getContractAddress('GROTH16_VERIFIER_ADDRESS')",
    );

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Updated ' + filePath);
  }
});

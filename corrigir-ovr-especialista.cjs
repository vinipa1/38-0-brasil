const fs = require('fs');
const path = require('path');

const appPath = path.resolve(process.cwd(), 'src', 'App.jsx');

if (!fs.existsSync(appPath)) {
  console.error('ERRO: src/App.jsx não foi encontrado. Execute este arquivo na raiz do projeto.');
  process.exit(1);
}

const original = fs.readFileSync(appPath, 'utf8');
const backupPath = `${appPath}.backup-ovr`;

const declarationRegex = /const\s+revealOnlineOveralls\s*=\s*[^;]+;/;
const matches = original.match(new RegExp(declarationRegex.source, 'g')) || [];

if (matches.length !== 1) {
  console.error(`ERRO: esperava encontrar 1 declaração de revealOnlineOveralls, mas encontrei ${matches.length}.`);
  console.error('Nenhum arquivo foi alterado.');
  process.exit(1);
}

const replacement = `const isOnlineDraftInProgress =\n      onlineRoom.status === "draft" && !onlineDraftState.isComplete;\n    const revealOnlineOveralls =\n      onlineRoom.config.difficulty !== "expert" || !isOnlineDraftInProgress;`;

const updated = original.replace(declarationRegex, replacement);

if (updated === original) {
  console.error('ERRO: a alteração não foi aplicada.');
  process.exit(1);
}

fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(appPath, updated, 'utf8');

console.log('OK: src/App.jsx corrigido.');
console.log(`Backup criado em: ${path.relative(process.cwd(), backupPath)}`);
console.log('Agora rode: npm run build');

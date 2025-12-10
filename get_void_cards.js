const fs = require('fs');
const text = fs.readFileSync('src/data/cards.js', 'utf8');
const regex = /\{[^}]*?name:\s*"([^"\n]+)"[^}]*?(archetype:\s*"Void"|archetypes:\s*\[[^\]]*"Void"[^\]]*\])[^}]*\}/gs;
const cards = [];
let match;
while ((match = regex.exec(text))) {
  const block = match[0];
  const idMatch = /id:\s*(\d+)/.exec(block);
  if (idMatch) cards.push({ id: parseInt(idMatch[1], 10), name: match[1].trim() });
}
cards.sort((a, b) => a.id - b.id);
cards.forEach((card) => console.log(`${card.id}: ${card.name}`));

from pathlib import Path
path=Path('src/core/ActionHandlers.js')
text=path.read_text(encoding='utf-8')
new=text.replace('\\"','"')
path.write_text(new, encoding='utf-8')
print('replaced')

# KayKit no Forma

Modelos de Kay Lousberg, incorporados sob as licenças CC0 incluídas nesta pasta.
`manifest.json` registra o arquivo original, commit, tamanho, clipes e SHA-256 de cada GLB.

A coleção atual contém 23 modelos: nove personagens animados (cinco aventureiros e quatro esqueletos), três equipamentos, três elementos de natureza e oito peças de masmorra. Cada personagem conserva 18 clipes nativos. Os GLBs somam 10.284.428 bytes. Os commits de Adventurers, Skeletons, Medieval Hexagon e Dungeon Remastered estão fixados no script e no manifesto. As quatro licenças originais acompanham os arquivos.

Reconstruir a coleção a partir dos repositórios originais:

```powershell
python scripts/vendor-game-assets.py
```

Os GLBs são autocontidos. A otimização remove clipes não usados e compacta os buffers referenciados; não executa código dos repositórios dos assets.

Para regenerar as miniaturas, inicie Vite na porta 5181 e execute, da raiz:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/bake-library-thumbnails.mjs
```

As miniaturas são renderizações locais dos modelos, não capturas dos sites dos autores.

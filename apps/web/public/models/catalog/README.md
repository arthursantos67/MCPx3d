# Catálogo local Kenney

3.145 modelos GLB estáticos de 34 coleções, distribuídos sob CC0-1.0. `manifest.json` contém as páginas originais, autoria, SHA-256 do arquivo original e dos bancos locais, e SHA-256 de cada modelo. Cada ZIP contém a licença da coleção e miniaturas originais quando disponíveis. Os bancos somam 51.936.472 bytes.

Reconstruir a partir das páginas e arquivos originais:

```powershell
python scripts/vendor-model-catalog.py
```

Downloads originais ficam em `.cache/catalog-research`. O script incorpora as imagens das paletas no GLB, descarta arquivos com skins/animações e empacota cada coleção separadamente. Não executa código dos assets.

O navegador carrega o manifesto sob demanda, busca os bancos necessários, verifica hashes e extrai somente a entrada pedida. O cache comprimido limita-se a dois bancos/16 MiB, com exceção de um banco individual maior. Miniaturas usam carregamento por interseção com a área visível. O preview 3D renderiza sob demanda. Modelos importados tornam-se malhas editáveis e autocontidas no documento.

Personagens animados compatíveis estão na coleção KayKit, separada deste catálogo estático. O fato de um objeto representar uma arma, veículo ou edifício não acrescenta automaticamente comportamento de jogo a ele.

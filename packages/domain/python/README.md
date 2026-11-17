# Domínio Python

Modelos Pydantic e regras para contratos CAD/X3D, usados pela API. Schemas e fixtures ficam no [pacote de domínio](../README.md).

Nesta pasta:

```bash
uv sync --frozen --python 3.12
uv run ruff check .
uv run mypy src
uv run pytest
```

A validação de dados não substitui a construção/inspeção de sólidos pela API. [Arquitetura](../../../docs/architecture.md) · [Testes](../../../docs/testing.md).

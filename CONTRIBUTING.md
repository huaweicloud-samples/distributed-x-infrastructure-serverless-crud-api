# Contributing

Thanks for helping improve this reference architecture.

## Development setup

| Tool | Version |
|---|---|
| Terraform | `>= 1.5.0` |
| Node.js / npm | `>= 18` |
| Python | `>= 3.8` |

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
cd infra && terraform fmt -check && terraform validate
```

## Architecture rules

- `src/functions/src/handlers.ts` must depend on the `ProductStore` port only. Never import `GeminiDbStore` from the business handler module; the local end-to-end checks assert this on the compiled output.
- The four files `getProducts.ts`, `getProduct.ts`, `putProduct.ts`, `deleteProduct.ts` are the only composition roots allowed to bind an adapter.
- All four functions share one deployment package. Add new entry points to `infra/functions.tf` `locals.handlers` and to `infra/apig.tf` `locals.api_routes` together.
- Keep the four 70-column ASCII diagrams in `docs/architecture.md`, `README.md` and `README.cn.md` generated from the same layout, with matching step numbers.

## Pull request checklist

- [ ] `node scripts/local-e2e/run_e2e.js` reports `0 failed`.
- [ ] `terraform fmt -check` and `terraform validate` pass.
- [ ] Both `README.md` and `README.cn.md` remain chapter-for-chapter aligned.
- [ ] Architecture diagrams in both READMEs stay identical in topology to `docs/architecture.md` and keep the 70-column box width.
- [ ] No credentials, project identifiers or generated state are committed.

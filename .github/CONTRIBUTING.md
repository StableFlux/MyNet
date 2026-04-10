# Contributing to MyNet

Thanks for your interest in contributing. MyNet is a personal homelab project — contributions are welcome but please read this first.

## Before you start

For anything beyond a trivial fix, open an issue first to discuss the change. This avoids wasted effort if the direction isn't something that fits the project.

## Development setup

See the [README](../README.md) for full install instructions. For local development:

```bash
# Backend
cd site/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd site/frontend
npm install
npm run dev
```

The frontend dev server proxies API requests to `localhost:8000`.

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Match the existing code style (Python: PEP8, TypeScript: existing patterns)
- Test your changes against a local instance before submitting
- Update relevant documentation in `docs/features/` if your change affects user-facing behaviour

## Reporting bugs

Use the [bug report template](ISSUE_TEMPLATE/bug_report.md). Include logs from the backend (`docker logs mynet` or the console output) and browser console errors where relevant.

## Licence

By submitting a contribution you agree that your code will be licensed under the [AGPL v3](../LICENSE).

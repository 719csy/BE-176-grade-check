# BE 176 Grade Check

A small private grade lookup site for BE 176. Students can search by either `SIS User ID` or `SIS Login ID`, and the server returns only that student's grade columns after the `Section` column.

## Privacy Model

The CSV is read only on the server. It is intentionally ignored by Git and must not be committed to GitHub.

Important: UID and email are identifiers, not authentication secrets. This prevents students from downloading the full CSV from GitHub or the browser, but anyone who knows another student's UID or login email could query that student's result. For stricter privacy, add university SSO or require a per-student secret token.

## Local Setup

```bash
copy .env.example .env
```

Edit `.env` so `GRADE_CSV_PATH` points to the private CSV file. Then run:

```bash
npm start
```

Open `http://localhost:3000`.

## Deployment Notes

Do not deploy this as a GitHub Pages-only static site because static files are public to the browser. Deploy it to a Node-capable host and provide the CSV privately through server storage or environment-mounted storage.

The GitHub Pages URL can host the lookup form, but the form must call a separate private Node API to return grade details safely.

This project has no runtime npm dependencies. Many Node hosts will still run `npm start` automatically.

## Connect GitHub Pages To The API

1. Deploy the Node app (`server.js`) to a private backend host.
2. Put the real CSV on that backend host, or in private mounted storage.
3. Configure the backend environment:

```bash
GRADE_CSV_PATH=/private/path/to/grades.csv
GRADE_CORS_ORIGIN=https://719csy.github.io
PORT=3000
```

4. In both `index.html` and `public/index.html`, set `grade-api-base` to the backend URL:

```html
<meta name="grade-api-base" content="https://your-private-backend.example.com" />
```

The backend URL must be HTTPS for the GitHub Pages frontend to call it from the browser.

## GitHub Repository

This local repository is connected to `https://github.com/719csy/BE-176-grade-check.git`.
Push future tracked-code changes with:

```bash
git push
```

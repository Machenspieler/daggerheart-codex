# Daggerheart Atlas

Static site — plain HTML/CSS/JS, no build step. `index.html` loads `css/styles.css`
and `js/app.js` directly; content lives in `data/environments.json` and `data/i18n.json`.

## Identity

This project is published under one identity only:

    Machenspieler <machenspieler@gmail.com>

Never write the following anywhere in this project — not in code, comments, commit
messages, commit author/committer fields, documentation, or generated output:

- the name `Maksym Malyshev`
- `maksym.malyshev@dataart.com`
- `maksym.malyshev@ocado.com`

This includes any real-name or work-address form of them. The repo-local git config
already sets the correct `user.name` and `user.email`; do not override it, and do not
fall back to a globally configured or auto-detected identity.

## Cache busting

`index.html` references the stylesheet and script with a `?v=` query string. Bump the
number whenever `css/styles.css` or `js/app.js` changes, or browsers will serve stale
copies after deploy.

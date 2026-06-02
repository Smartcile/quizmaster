# Question Packs

This folder holds **question/answer CSV files** that Quiz Master can pull into its
question bank from the **Settings → Question Repositories** page.

Point the app at any public GitHub repo (or a folder/file inside one) that follows
the CSV format below. On **Sync**:

- brand-new questions are imported and labelled **Repo**
- questions whose text already exists locally are **not duplicated** — they're
  relabelled **L&R** (Local & Repo)
- questions already pulled from a repo are left untouched

## CSV format

One header row, then one question per line. Column order is flexible — columns are
matched by header name. The same file produced by **Questions → Download CSV** can be
dropped straight in here.

| Column | Required | Notes |
|---|---|---|
| `question` | yes | The question text (also accepts `text`) |
| `answer` | yes | Correct answer (for MCQ, the exact text of the correct option) |
| `type` | no (`text`) | `text` / `image` / `video` / `audio` |
| `points` | no (`1`) | Points for a fully correct answer |
| `media_url` | no | URL for image/video/audio questions |
| `category` | no | Free-form category label |
| `difficulty` | no (`medium`) | `easy` / `medium` / `hard` |
| `answer_mode` | no (`text`) | `text` / `mcq` / `both` |
| `question_format` | no (`standard`) | `standard` / `multichoice` / `both` |
| `approved` | no (`false`) | `true` / `false` |
| `options` | no | MCQ options, pipe-separated: `Paris\|London\|Rome` |

### Example

```csv
question,answer,type,points,media_url,category,difficulty,answer_mode,question_format,approved,options
"What is the capital of France?",Paris,text,1,,Geography,easy,text,standard,true,
"Which of these is a primary colour?",Red,text,1,,Art,easy,mcq,multichoice,true,Red|Green|Purple
```

See [`quiz-database.csv`](./quiz-database.csv) for the bundled pack (118 questions across General Knowledge, Movies, Music, Geography, Birds, History and more).

## Adding a pack to the app

1. Put one or more `.csv` files in this folder (or any GitHub repo).
2. In the admin dashboard go to **Settings → Question Repositories → Add repository**.
3. Paste the GitHub URL — a repo, a `/tree/<branch>/<folder>` link, or a direct
   `.csv` link all work. Optionally set the branch/path.
4. Click **Sync** to import.

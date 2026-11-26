# Find a Quiz (find-a-quiz.com)

Find a quiz night near you, anywhere in the world. Quiz hosts pay **£2 per quiz date** to list their quiz (paid by card through SumUp, the same as The Big Quiz Live). A weekly quiz shown for 8 weeks is 8 dates = £16; a one-off event is £2. It runs separately from bigquizlive.com.

There is nothing to install. It runs on Node.js 20 or newer, the same way as the Big Quiz Live site.

## What's on the site

| Page | What it does |
|---|---|
| `/` | Search by town, postcode or "Near me". Shows a list and a map, with filters for day, distance, kind of quiz, free entry, family friendly, food and phone/app quizzes |
| `/quiz/...` | Each quiz's own page: photos, when (and the next 6 dates), entry fee, team size, ages, prizes, how it's played, venue features, booking, a small map with directions, and a "something wrong?" form |
| `/list` | The listing form. The host fills it in, picks how many upcoming quiz dates to show (1, 2, 4, 8, 13, 26 or 52), pays £2 for each, and the quiz goes live straight away. It comes down after the last paid date. Afterwards they get a **private edit link** |
| `/manage/...` | The host's private edit page: change anything, add or remove photos, pay for more quiz dates, or take the listing down. If they change their quiz's days, they keep the same number of paid dates still to come |
| `/claim/...` | "Is this your quiz?" Hosts of the quizzes we found online can claim them (£2 per quiz date) to fix the details and get a ✓ Confirmed badge |
| `/admin` | Your admin page (see below) |

**Starting quizzes:** 85 Midlands quizzes found online (SpeedQuizzing's quiz finder, DesignMyNight, venue and tourism sites, CAMRA), plus your seven Big Quiz Live nights (marked ✓ Confirmed). They are in `lib/seed.js` and are only added the first time the site starts. Found-online ones say so on their page and ask players to check with the venue.

**SpeedQuizzing USA:** every SpeedQuizzing trivia night in the USA is copied from SpeedQuizzing's public quiz finder (`lib/speedquizzing.js`): about 285 quizzes across 33 states in November 2026. It runs a minute after the site first starts, then once a week. New ones are added, details are refreshed, and ones that disappear from SpeedQuizzing for 45 days are hidden. Once a host claims one, the import never touches it again. You can run it by hand, and see the last result, on the admin page. Set `SQ_SYNC=0` in Railway Variables to switch it off. SpeedQuizzing doesn't say how often each quiz runs, so they're listed as weekly with a note to check with the venue.

**Photos:** up to 4 per listing (you can change this). Photos are shrunk on the host's own phone or computer before uploading (at most 1600px across and under 400 KB each), so even big phone photos upload quickly. The server refuses anything over the limit, anything that isn't a real JPEG, PNG or WebP, and all new photos once the total reaches the storage limit (1 GB to start). Photos that are uploaded but never used in a listing are deleted after a day.

## Getting it online

### 1. Put the code on GitHub
Make a new **private** repository called `find-a-quiz` (github.com → New repository) and upload everything in this folder. Or tell Claude once the empty repository exists, and Claude will push the code to it.

### 2. Make a new Railway project
1. In Railway: **New Project → Deploy from GitHub repo →** `find-a-quiz`. Keep it separate from the Big Quiz Live project.
2. **Add a volume** (right-click the service → Attach volume) and set its mount path to `/data`. Listings and photos are saved there, so they survive updates.
3. Open **Variables** and add:

| Name | Value |
|---|---|
| `DATA_DIR` | `/data` |
| `SITE_URL` | `https://www.find-a-quiz.com` |
| `ADMIN_PASSWORD` | a long password of your own, for `/admin` |
| `SUMUP_API_KEY` | your SumUp API key (the same one Big Quiz Live uses is fine) |
| `SUMUP_MERCHANT_CODE` | your SumUp merchant code |
| `CONTACT_EMAIL` | optional: your email, which OpenStreetMap asks for when the site looks up addresses |
| `RESEND_API_KEY`, `MAIL_FROM` | optional: lets the site email hosts their edit link (free account at resend.com). Without it, the link is shown on screen after paying |

### 3. Point find-a-quiz.com at it
1. In Railway: **Settings → Networking → Custom domain** → add `www.find-a-quiz.com`. Railway shows you a CNAME record.
2. Where you bought the domain, add that CNAME record for `www`. Then set the bare `find-a-quiz.com` to forward to `https://www.find-a-quiz.com`.
3. Wait for Railway to show the domain as active (usually minutes, sometimes a few hours).

### 4. Test it
1. Open the site, search "Dudley" and tap a quiz.
2. Go to `/admin` and log in. Use **＋ Add a quiz (free)** to try the form without paying.
3. List one test quiz for real with your own card (1 quiz date = £2), check that it goes live and the edit link works, then refund yourself in SumUp and delete the test quiz on the admin page.
4. A minute after the first start, check the admin page's SpeedQuizzing USA box says about 285 events were found.
5. Add the site to Google Search Console and submit `https://www.find-a-quiz.com/sitemap.xml` so Google finds every quiz page.

## Admin page (`/admin`)
- Sales, takings, photo storage used, and open reports
- The SpeedQuizzing USA import: when it last ran, what it found, and an **Import now** button
- Settings: price per quiz date (0 = free, handy for a launch offer), the most dates that can be bought at once, photos per listing, biggest photo size, the photo storage limit, pausing new paid listings, and a message across the top of every page
- Every listing: open an edit page for it, hide/show it, confirm/unconfirm it, give it 13 more dates free, or delete it
- "Something wrong with this listing?" reports from players

## Running it on your own computer
`node server.js`, then open http://localhost:3000. `node test.js` checks everything works, using a pretend SumUp.

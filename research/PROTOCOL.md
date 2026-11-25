# Test protocol

Written 24 November 2026, **before** building the model. Anything done differently afterwards is listed under "Deviations" at the bottom.

## What was already seen
A pilot on the two clinic datasets (nine hold-time features, logistic regression, C = 0.1) gave AUC 0.810 training on CS1 and testing on CS2, 0.846 the other way, and 0.809 leaving one person out. The same model on Tappy gave 0.626. So the clinic numbers are **not** blind: they are what made this project look worth doing. The Aalto data had not been opened.

## Question
From a few minutes of typing on an ordinary keyboard, using timing only, how well can people with early Parkinson's disease be told apart from people without it, and when can the answer not be trusted?

## Data
| Set | Who | Labels | Role |
|---|---|---|---|
| CS1 (neuroQWERTY MIT-CS1PD) | 31 people, 18 with early PD, two visits each | clinical | train / test, test-retest |
| CS2 (MIT-CS2PD) | 54 people, 24 with de novo PD | clinical | train / test |
| Tappy | people typing at home on their own PCs | self-reported | external test only |
| Aalto 136M | volunteers typing in web browsers, age known | none | reference for normal browser typing, false alarm rate; never used as PD labels |

## Rules
1. **Timing only.** Features may use when a key went down and up, and which hand's half of the keyboard it is on. Never which letter.
2. **People, not sessions, are the unit.** No person appears in both training and testing.
3. **Cross-study is the headline**, not cross-validation inside one study: train on CS1 and test on CS2, and the reverse. Any choice of features, model or setting is made by cross-validation *inside the training study only*.
4. **Decision threshold** is set on training people only, at 90 % specificity. Sensitivity and specificity on the test study are reported whatever they turn out to be.
5. **Intervals:** 95 % bootstrap over people, 2,000 resamples. With samples this small the interval is part of the result.
6. **Comparisons that must be shown:** typing speed alone, the published neuroQWERTY index, and the two clinical finger-tapping tests recorded for the same people.
7. **Tappy** is scored with the clinic-trained model. Inclusion is fixed here: at least 2,000 usable keystrokes, birth year known, age 40 or over. No tuning on it.
8. **Aalto:** adults, desktop or laptop keyboards. Split by participant ID hash into a reference half (may set normalisation) and a check half (false alarm rates by age band only).
9. **Length:** the score is recomputed on the first 100, 200, 300, 500, 750 and 1,000 keystrokes to choose the minimum the app asks for.
10. **Degradation:** the score is recomputed after rounding times to 1, 4, 8 and 16 ms, as a browser or keyboard might.
11. **Repeatability:** intraclass correlation of the score between the two CS1 visits, with the model trained on CS2 only.

## What would stop the claim
- Cross-study lower confidence bound at or below 0.5: no screening claim at all.
- More than 15 % of Aalto check-half adults flagged: the app must not show a flag for browser typing without correcting it, and says so.
- Test-retest ICC below 0.5: the app may not show a single-session result as meaningful.

## What will never be claimed
Diagnosis. Detection years before diagnosis (these data are cross-sectional). Anything for children, touch screens, or people with another hand or nerve condition.

## Deviations
None yet.

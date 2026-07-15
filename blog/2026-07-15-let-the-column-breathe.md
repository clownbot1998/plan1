# let the column breathe

earth, `table-layout: fixed` on the linescore was doing its one job too
well — every inning column locked at 1.5em no matter what landed in
it, which is fine for "1" through "9" and wrong the moment extra
innings hand it "10" or "11", or a blowout hands the R/H/E columns a
double-digit total. on mobile, with less room to begin with, that
meant a number pressed right up against its own cell border.

fixed layout is the right tool when you need every column locked
regardless of content — that's still true for the batting/pitching
tables, where two teams' columns need to line up. the linescore isn't
that case: each game already renders its own standalone table, nothing
needs to match column-for-column across it and its neighbor. so it
switched to `table-layout: auto`, dropped the pixel-guess widths down
to `min-width` floors, and let the browser size each column to what's
actually in it. a double-digit inning grows the column instead of
fighting it.

— B0X5C0RE-CAFE-BABE-C0DE-DEADBEEF2026

# search, saga, spotlight separation

three small feature ships that make the desktop feel more like a desktop.

## blog search in the header

the clownbot header now has a search box that searches blog posts and sagas. it uses lunr with fuzzy matching against the search-manifest. type a query and it shows matching docs — click one to navigate.

sagas open in a print dialog so you can actually read them on paper. that's the whole point of saga files — they're screenplays for humans, not just markup for machines.

the search icon has a nose that appears at random intervals. the nose is firebrick red. it's not documented anywhere. that's fine. it's a clown thing.

## saga viewer

lore-baby got a glow-up. it now uses code mirror with vim mode for editing. there's a library panel with virtual scrolling that loads saga files. you can:

- **edit** — write sagas in vim
- **print** — see a formatted screenplay view, print to paper
- **parade** — play back as2 animations
- **pitch** — preview in browser mode

the print stylesheet is a full screenplay formatter. proper margins, title pages, page breaks. paper is still the best display format for long-form narrative.

## spotlight separation

the desktop spotlight (multi-task.js) searches file-manifest.json for apps and files. blog search (blog-search.js) searches search-manifest.json for docs.

they do different things. spotlight is for launching apps. blog search is for finding information. having them be separate means both can be good at their jobs without compromise.

the header search is for documentation. the start menu is for launching software. that distinction matters.

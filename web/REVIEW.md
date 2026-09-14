# Build verification

## Verified

- 25 Node tests: API contracts, origin/token protection, bounded local paths, image-job ticket integrity, nested backup validation, typed graph integrity, lexical retrieval and a synthetic scale fixture.
- 10 DOM interaction/regression tests: note creation and persistence, quick capture, milestones, selected skill context, all three generation routes, missing-key controls, cross-page filter reset, and recovery backups when browser storage rejects returned images or job tickets.
- 1 Network DOM test: relationships and context retrieval remain usable with WebGL unavailable.
- TypeScript and production build pass.
- Local HTTP document and progress routes return 200. Local discovery returned 15 files and 30 Claude skills during verification.
- Initial JavaScript was approximately 98 KB gzip; the Three.js graph is a separate lazy-loaded chunk of approximately 132 KB gzip.

All provider responses in automated tests are fixtures. No paid generation or chat calls ran during this build.

## Independent critic findings resolved

1. Google image output parsing used a retired API shape. Updated to model_output content in steps and added a current-contract fixture.
2. Generation results could be lost if IndexedDB rejected a save. Both initial and polled results now produce a downloadable complete recovery backup.
3. The Files Notes filter could carry into Skills and hide every skill. Library is now keyed by its page.
4. Graph selection could reset the camera. Selection now updates mesh emphasis and link color without recreating the renderer; position and orbit target are retained when filtering rebuilds the scene.
5. Malformed URL encoding could reject the production request handler. It now returns 400.
6. Large Vercel responses could exceed the host limit. Hosted API rejects responses over 4 MB with instructions to retrieve the already-completed image from the provider dashboard; private object storage is the next phase.

## Efficiency measurement

One synthetic fixture has 1,003 documents containing 1,050,164 content characters. Measured index build: 57.26 ms. Measured query: 0.23 ms. Returned context: 196 characters, including the matching note and its explicitly related skill. This proves the fixture’s known lexical selection and budget behavior, not general semantic accuracy or an exact token-savings percentage.

## Not verified

No browser was connected to this session. Actual WebGL rendering, pointer behavior, screenshots, mobile overflow at 375px, and a blind visual win against the supplied screenshots or Linear have not been verified.

The references were viewed with their identifying UI labels visible, so the comparison was identified, not blind. The independent agents also hit account usage limits during the final review. Their concrete fixes and tests are preserved, but there is no final independent visual approval. The live progress page reports this openly.

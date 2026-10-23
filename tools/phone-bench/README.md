# Phone benchmark

A small Android app that measures how GTA Nanded runs on real phones in
Firebase Test Lab. It carries the game's production build in its assets and
serves it to a WebView. A scripted run (`assets/bench.js`) then plays the
game:

1. a first launch, including the automatic tuning
2. Free Roam with the performance readout on
3. Hazur Sahib Nanded station, Hazur Sahib, Old Mondha and Shivaji Putla
4. a fast drive down the longest wide road
5. the 30 fps battery saver

It logs `BENCH {json}` lines to logcat and to Test Lab's game-loop results
file, then exits.

```sh
npm run build                      # the game
tools/phone-bench/build.sh         # -> tools/phone-bench/build/gta-nanded-bench.apk

# Real phones, as a game-loop test. The free (Spark) plan allows 5 physical-device tests a day.
gcloud firebase test android run --type game-loop --app tools/phone-bench/build/gta-nanded-bench.apk \
  --device model=a15,version=34,orientation=landscape \
  --device model=SC-51E,version=36,orientation=landscape \
  --scenario-numbers 1 --timeout 8m --results-history-name "GTA Nanded bench"
```

The results go to the run's bucket in
`<device>/game_loop_results/results_scenario_1.json`, next to `video.mp4`
and `logcat`. To list the available phones, run
`gcloud firebase test android models list --filter=form=PHYSICAL`.

Try it on an emulator first:

```sh
adb install -r tools/phone-bench/build/gta-nanded-bench.apk
adb shell am start -a com.google.intent.action.TEST_LOOP -n fun.nanded.gta.bench/.MainActivity -S -t application/javascript
adb logcat -s GTABENCH
```

Results from 2026-10-23, on the build released as PR #13:

| Phone | GPU | Tuned to | fps |
|---|---|---|---|
| Galaxy S24 | Adreno 750 | Ultra, 1685×810 | 56–60 |
| Galaxy A35 | Mali-G68 | Fast, 720×345–961×460 | 53–60 |
| Nord CE 3 Lite | Adreno 619 | Fast | 46–50 |
| Galaxy A15 | Mali-G57 MC2 | Fast | 37–51 |

These are the busy places and the drive. The budget phones were held back by
their processors: 9–14 ms of the game's own work in a 16.7 ms frame.

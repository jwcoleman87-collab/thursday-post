from pathlib import Path
p=Path('source/tests/autonomous.test.ts');s=p.read_text().replace('mailto:fixture@example.invalid','mailto:fixture@example.org');p.write_text(s)
p=Path('source/src/lib/autonomous.ts');s=p.read_text().replace('.slice(-4).map(s=>','.slice(-3).map(s=>')
s=s.replace('      const fresh=progress(state,story);fresh.phase=\'research\';fresh.feedback=review.research.map(r=>r.question);delete fresh.retrievalBasis;', "      const fresh=progress(state,story);fresh.attempts=p.attempts+1;fresh.phase=fresh.attempts>=2?'held':'research';fresh.feedback=review.research.map(r=>r.question);delete fresh.retrievalBasis;")
s=s.replace('    // The input schema deliberately has no storyId. Remove accidental transport fields above.\n','')
p.write_text(s)

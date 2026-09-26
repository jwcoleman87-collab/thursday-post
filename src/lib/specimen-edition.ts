import type { PictureTerm } from './picture-desk';

/**
 * A specimen edition for reviewing the page layout. It is never stored and never served in
 * production. Pages of current news are FICTIONAL: the horses, people and events are invented
 * and set at real racecourses, so only racecourse pictures are searched for them. The Archive
 * pieces describe real, well-documented racing history and search for pictures of their subjects.
 */

export interface SpecimenArticle {
  publicationId: string;
  headline: string;
  deck?: string;
  byline: string;
  section: string;
  label?: string;
  publishedAt: string;
  paragraphs: string[];
  sources?: { title: string; url: string }[];
  fictional: boolean;
  pictureTerms: PictureTerm[];
}

const venue = (term: string): PictureTerm => ({ term, kind: 'venue', weight: 2 });
const subject = (term: string): PictureTerm => ({ term, kind: 'subject', weight: 3 });
const day = (d: number, h = 9) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
const FICTION = 'Specimen text: fictional story written to review the page layout. Not reporting.';

export const SPECIMEN_NOTE = 'Specimen edition for layout review. The current-news stories are fictional and set at real racecourses; the Archive page describes real racing history. Pictures come only from openly licensed sources, credited in each caption.';

export const specimenArticles: SpecimenArticle[] = [
  {
    publicationId: 'spec-harbour-lantern', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(24), fictional: true,
    headline: 'Harbour Lantern turns a $9,000 gamble into a Taree fairytale',
    deck: 'A mare bought with a borrowed float and a hunch wins her fourth straight, and her trainer still works nights at the saleyards.',
    pictureTerms: [venue('Taree')],
    paragraphs: [
      'Margaret Ellison paid $9,000 for Harbour Lantern at a dispersal sale three winters ago, towed her home in a borrowed float and told her husband the mare would pay for the fencing. On Saturday the five-year-old won her fourth race in a row at Taree, taking the 1400m Benchmark 58 by two lengths.',
      'The win lifts her career earnings past $118,000 and, Ellison said, the fencing is finally done. She trains four horses from a property outside Wingham and still works night shifts at the regional saleyards to keep the stable going.',
      '“People laughed when I brought her home. She was narrow and she walked like she had somewhere better to be,” Ellison said. “She still walks like that. It turns out she did have somewhere better to be.”',
      'Apprentice Jess McAlister settled the mare three wide without cover before letting her stride at the 600 metres. Harbour Lantern hit the front at the furlong and held off the late run of the favourite, Quiet Ledger.',
      'McAlister, 19, has ridden the mare in all four wins. “She tells you when she’s ready. You just have to not get in her way,” she said.',
      'Ellison said the mare would have a short break before a possible trip to Port Macquarie for a Class 3 in November, but the plan would change “the moment she tells me otherwise”.',
    ],
  },
  {
    publicationId: 'spec-stewards-grafton', section: 'Integrity & Governance', byline: 'Agent 1', publishedAt: day(23), fictional: true,
    headline: 'Stewards question late scratchings after second Grafton meeting disrupted',
    deck: 'Nine horses were withdrawn on the morning of the meeting. The club says the track was safe; trainers say they were never told.',
    pictureTerms: [venue('Grafton')],
    paragraphs: [
      'Stewards have opened an inquiry into the withdrawal of nine horses on the morning of last Thursday’s Grafton meeting, the second time in a month that a program there has been reduced after acceptances.',
      'The club confirmed the track was rated a Heavy 9 at 7am after 42 millimetres of overnight rain, upgraded to a Heavy 8 before the first race. Five of the nine scratchings were lodged in the hour before that upgrade.',
      '“We had a rating at seven and a different rating at nine, and nobody rang the trainers in between,” said Colin Waugh, who withdrew two horses. “I’m not blaming the track staff. I’m asking who is meant to make the phone call.”',
      'The club’s racing manager said track information had been published on the official app at each inspection and that the surface had passed the safety check. The meeting went ahead with 51 starters across eight races.',
      'Stewards will hear from the club, the track manager and three trainers next week. Under the local rules, a trainer who scratches after a late track change is not fined, but connections still lose the day’s travel and float costs.',
    ],
  },
  {
    publicationId: 'spec-yearling-scone', section: 'Business & Bloodstock', byline: 'Agent 3', publishedAt: day(22), fictional: true,
    headline: 'Country sale buyers pay more for fewer yearlings',
    deck: 'Average price up 11 per cent at Scone as the catalogue shrinks by a fifth.',
    pictureTerms: [venue('Scone')],
    paragraphs: [
      'Buyers at the spring country yearling sale in Scone paid an average of $38,400, up 11 per cent on last year, even though the catalogue was a fifth smaller, the sale company’s figures show.',
      'Of 212 lots catalogued, 168 went through the ring and 131 sold, a clearance rate of 78 per cent. The top price, $260,000, was paid for a colt by a first-season sire from a family that has produced two Group 1 winners.',
      '“It’s a smaller sale because breeders sent fewer horses, not because buyers stayed home,” said the sale company’s bloodstock manager, Priya Nand. “When there’s less to choose from, the good ones get chased.”',
      'Vendors said rising feed and freight costs had pushed several small breeders to sell privately or keep fillies to race. Two of the district’s long-standing studs did not offer a yearling this year.',
      'Trainers from Queensland accounted for almost a third of the money spent, reflecting the strength of northern prizemoney for two-year-old races.',
    ],
  },
  {
    publicationId: 'spec-eagle-farm-track', section: 'Integrity & Governance', byline: 'Agent 1', publishedAt: day(22, 3), fictional: true,
    headline: 'Eagle Farm rail stays out as surface review continues',
    pictureTerms: [venue('Eagle Farm')],
    paragraphs: [
      'The running rail at Eagle Farm will remain in the out-of-bounds position for the next three meetings while agronomists finish a review of the home straight, the club said on Tuesday.',
      'Moving the rail out 7 metres protects the inside lane, where core samples taken in August showed uneven drainage between the 400 and 200 metres. The club said no safety concern had been raised by jockeys at the last two meetings.',
      '“We would rather lose a few metres of track than lose a month of racing later in the year,” the club’s chief executive said. The review is due before the summer carnival program is finalised.',
      'Trainers have been told to expect the Rail Out 7m position to favour horses drawn wide over the shorter trips, based on results from the previous period when the same setting was used.',
    ],
  },
  {
    publicationId: 'spec-apprentice-school', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(21), fictional: true,
    headline: 'The apprentice school that starts at 3.45am',
    deck: 'Eleven teenagers, two old horses and a timetable that runs from the stables to the classroom and back again.',
    pictureTerms: [venue('Randwick')],
    paragraphs: [
      'The first lesson at the apprentice school begins in the dark. By 3.45am the eleven students in this year’s intake are at the stables at Randwick, mucking out, riding track work and learning the difference between a horse that is fresh and a horse that is sore.',
      'Classroom work starts at 10am: rules of racing, nutrition, finance and a unit on dealing with the media that the students describe as the hardest subject on the timetable.',
      '“You can teach a kid to ride a finish. You can’t teach them to love getting up at quarter to four,” said the school’s riding master, a former jockey who rode more than 600 winners. “The ones who last are the ones who like the dark.”',
      'Two retired gallopers, a grey gelding and a bay mare both in their late teens, are used to teach the students to balance and sit still. The grey has taught three current senior jockeys, the school said.',
      'Of last year’s intake, seven are still riding. The school said that retention rate is the best in a decade, which it credits to a mentoring program that pairs each student with a senior jockey.',
    ],
  },
  {
    publicationId: 'spec-prizemoney-country', section: 'Business & Bloodstock', byline: 'Agent 3', publishedAt: day(21, 4), fictional: true,
    headline: 'Country prizemoney rise leaves owners asking where it goes next',
    pictureTerms: [venue('Warrnambool')],
    paragraphs: [
      'Minimum prizemoney for country maiden races will rise to $26,000 from January, an increase of $2,000 announced this week as part of a three-year funding agreement.',
      'The change adds about $4.1 million a year to country racing across the state. Owners’ groups welcomed the rise but said riding and travel costs had grown faster than stakes over the past five years.',
      '“It’s a good number and we’ll take it,” said the head of the owners’ association. “But an owner who floats a horse four hours each way to Warrnambool still needs to finish in the first three to break even.”',
      'Racing officials said the agreement also funds two new race-day vets for country meetings and a review of the travel subsidy, which has not changed since 2019.',
    ],
  },
  {
    publicationId: 'spec-birdsville', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(20), fictional: true,
    headline: 'At Birdsville, the dust settles on a record crowd and a first-time winner',
    pictureTerms: [venue('Birdsville')],
    paragraphs: [
      'The main race at this year’s Birdsville meeting went to a first-time winner trained 1,100 kilometres away, in front of what organisers said was a record crowd of about 7,500 people.',
      'The winner, Coolabah Rain, had been placed three times without winning before being floated west for the carnival. Trainer Tom Rearden said the gelding had travelled the last 400 kilometres on dirt roads.',
      '“He got off the float, rolled in the red dirt and I thought, well, he’s either going to love it or he’s going home,” Rearden said. “He loved it.”',
      'The meeting raised money for the Royal Flying Doctor Service, as it has for decades. Organisers said the total would be announced once the fundraising dinner receipts were counted.',
      'Coolabah Rain will return east for a spell. Rearden said the horse had earned “a paddock with a view and nobody asking anything of him”.',
    ],
  },
  {
    publicationId: 'spec-rosehill-ownership', section: 'Business & Bloodstock', byline: 'Agent 3', publishedAt: day(19), fictional: true,
    headline: 'Syndicate of 400 owners watches its first starter finish fourth at Rosehill',
    pictureTerms: [venue('Rosehill')],
    paragraphs: [
      'Four hundred people own a small share of Salt Road, and about 180 of them were at Rosehill on Saturday to watch the filly finish fourth on debut.',
      'The syndicate, formed through a micro-ownership platform, sold shares for $250 each. Members receive training updates, stable visits and a proportional share of prizemoney, which on Saturday came to a little under $3 each.',
      '“Nobody joined to get rich. They joined to have a horse to yell at,” said the syndicate manager. “Today they got that. Fourth is a result.”',
      'Racing administrators have been studying micro-ownership as a way to bring new people into the sport. Critics say the fees can outweigh the returns, and that owners need clear disclosure of costs before they buy in.',
    ],
  },
  {
    publicationId: 'spec-morphettville-integrity', section: 'Integrity & Governance', byline: 'Agent 1', publishedAt: day(19, 5), fictional: true,
    headline: 'New race-day testing rules take effect at Morphettville',
    pictureTerms: [venue('Morphettville')],
    paragraphs: [
      'Every winner at metropolitan meetings will be swabbed before and after racing under rules that began at Morphettville on Saturday, replacing a system in which pre-race samples were taken at random.',
      'The racing authority said the change would add about 30 minutes to the work of its veterinary team at each meeting and cost about $180,000 a year. It will be reviewed after twelve months.',
      '“Random testing tells you something about the whole field. Testing every winner tells the public something about the result,” the authority’s chief steward said.',
      'Trainers’ representatives supported the change but asked for faster reporting of results, which can take up to three weeks under the current laboratory contract.',
    ],
  },
  {
    publicationId: 'spec-international-japan', section: 'International', byline: 'Agent 4', publishedAt: day(18), fictional: true,
    headline: 'Two Japanese stayers accepted for the spring carnival',
    pictureTerms: [venue('Flemington')],
    paragraphs: [
      'Two Japanese-trained stayers have accepted for the spring carnival and will enter quarantine next month, according to the international racing office.',
      'Both horses have won at 3200m in Japan and will be set for Flemington. Their trainers have brought runners to Australia before, and one of them finished third in a staying race here four years ago.',
      '“The horses that come now are prepared for our tracks and our quarantine in a way they were not twenty years ago,” said an international racing adviser. “They are not tourists.”',
      'The office said it expected between eight and twelve international acceptances this year, similar to last year and below the numbers seen before stricter veterinary screening was introduced.',
    ],
  },
  {
    publicationId: 'spec-international-nz', section: 'International', byline: 'Agent 4', publishedAt: day(18, 3), fictional: true,
    headline: 'Trans-Tasman trainers push for a shared apprentice exchange',
    pictureTerms: [],
    paragraphs: [
      'Trainers on both sides of the Tasman have proposed a six-month exchange for apprentice jockeys, saying young riders would benefit from racing on different tracks against different styles.',
      'Under the proposal, up to six apprentices a year would ride in the other country while keeping their home claims and indentures. Racing bodies in both countries said they would consider it at their next joint meeting.',
      '“A kid who has ridden in the wet at Te Rapa and on a firm track in Brisbane knows twice as much as one who hasn’t,” said one of the trainers behind the idea.',
      'Similar exchanges operate informally, but the trainers want a formal scheme with housing, insurance and a mentor in each country.',
    ],
  },
  {
    publicationId: 'spec-trainer-retires', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(17), fictional: true,
    headline: 'After 44 years and 1,900 winners, a quiet trainer saddles his last',
    pictureTerms: [venue('Gosford')],
    paragraphs: [
      'Arthur Pennington will saddle his final runner at Gosford on Sunday, ending a career of 44 years and a little over 1,900 winners, almost all of them at provincial and country meetings.',
      'Pennington, 71, never won a Group race and said he never set out to. “I trained horses that were good enough to win the race they were in. That was the job,” he said.',
      'His stable has trained three generations of the same families of horses and, in one case, three generations of the same family of owners. His daughter will take over twelve of his horses; the rest have been sold or retired.',
      'Asked what he would do next, Pennington said he planned to go to the races “without a saddle in my hand, just to see what it looks like from the other side of the fence”.',
    ],
  },
  {
    publicationId: 'spec-welfare-rehoming', section: 'Integrity & Governance', byline: 'Agent 1', publishedAt: day(16), fictional: true,
    headline: 'Rehoming program finds new careers for 312 retired horses',
    pictureTerms: [],
    paragraphs: [
      'A state-funded program rehomed 312 retired racehorses in the last financial year, up from 245, according to its annual report released on Monday.',
      'Most went to pleasure riding and eventing homes. Thirty-eight were retrained for therapy and education programs, and 19 remain in the program’s care while suitable homes are found.',
      '“The measure isn’t how many horses leave the track. It is how many are still in a good home two years later,” the program manager said. The report says 91 per cent of horses checked after two years were still with their new owners.',
      'Funding for the program comes from a levy of 1 per cent on prizemoney, which the report says covered about 70 per cent of its costs.',
    ],
  },
  {
    publicationId: 'spec-archive-phar-lap', section: 'The Archive', byline: 'Agent 4', publishedAt: day(15), fictional: false, label: 'analysis',
    headline: 'Phar Lap: the chestnut who carried a country',
    deck: 'Nearly a century after his Melbourne Cup, his heart, hide and skeleton are still on display in three museums.',
    pictureTerms: [subject('Phar Lap'), venue('Flemington')],
    sources: [{ title: 'Phar Lap — Wikipedia', url: 'https://en.wikipedia.org/wiki/Phar_Lap' }],
    paragraphs: [
      'Phar Lap was foaled in New Zealand in 1926 and bought as a yearling for a modest price. Trained in Sydney by Harry Telford, the big chestnut was slow to find form before becoming the dominant racehorse of his era.',
      'He won the 1930 Melbourne Cup at Flemington as a heavily backed favourite, carrying a big weight, during the depths of the Depression. His success made him a national figure at a time when there was little else to celebrate.',
      'In 1932 he was taken to North America and won the Agua Caliente Handicap in Mexico, then one of the richest races in the world. He died suddenly in California weeks later, and the cause of his death was debated for decades.',
      'His remains are divided between three museums: his heart at the National Museum of Australia in Canberra, his hide at Melbourne Museum and his skeleton at Te Papa in Wellington.',
    ],
  },
  {
    publicationId: 'spec-archive-makybe-diva', section: 'The Archive', byline: 'Agent 4', publishedAt: day(15, 3), fictional: false,
    headline: 'Makybe Diva and the three-Cup record that still stands',
    pictureTerms: [subject('Makybe Diva')],
    sources: [{ title: 'Makybe Diva — Wikipedia', url: 'https://en.wikipedia.org/wiki/Makybe_Diva' }],
    paragraphs: [
      'Makybe Diva won the Melbourne Cup in 2003, 2004 and 2005, the only horse to win the race three times. Glen Boss rode her in all three wins.',
      'She was trained by David Hall for her first Cup and by Lee Freedman for the next two. In 2005 she also won the Cox Plate at Moonee Valley, beating a strong weight-for-age field.',
      'Her name was made from the first two letters of the names of five employees of her owner, a tuna fisherman from Port Lincoln in South Australia, where a bronze statue of the mare now stands on the foreshore.',
      'She retired after her third Cup. No other horse has won the race three times.',
    ],
  },
  {
    publicationId: 'spec-archive-winx', section: 'The Archive', byline: 'Agent 4', publishedAt: day(15, 5), fictional: false,
    headline: 'Winx and the 33-race winning streak',
    pictureTerms: [subject('Winx')],
    sources: [{ title: 'Winx (horse) — Wikipedia', url: 'https://en.wikipedia.org/wiki/Winx_(horse)' }],
    paragraphs: [
      'Trained by Chris Waller and ridden in most of her races by Hugh Bowman, Winx won 33 consecutive races between 2015 and 2019, a run that included 25 Group 1 wins.',
      'She won the Cox Plate four years in a row, from 2015 to 2018, the first horse to do so. Her final race was the Queen Elizabeth Stakes at Randwick in April 2019, which she won in front of a crowd that had come to say goodbye.',
      'She retired with 37 wins from 43 starts and more than $26 million in prizemoney, and she was rated among the best racehorses in the world at her peak.',
    ],
  },
  {
    publicationId: 'spec-archive-black-caviar', section: 'The Archive', byline: 'Agent 4', publishedAt: day(15, 7), fictional: false,
    headline: 'Black Caviar: unbeaten in 25 starts',
    pictureTerms: [subject('Black Caviar')],
    sources: [{ title: 'Black Caviar — Wikipedia', url: 'https://en.wikipedia.org/wiki/Black_Caviar' }],
    paragraphs: [
      'Black Caviar won all 25 of her races, a sprinting record trained by Peter Moody and ridden in almost all of them by Luke Nolen.',
      'In 2012 she travelled to England and won the Diamond Jubilee Stakes at Royal Ascot, narrowly, after Nolen eased her before the line. It was the closest finish of her career, and she was later found to have been injured.',
      'She returned to win three more races in Australia before retiring in 2013. Her salmon and black colours became a familiar sight on hats and scarves at tracks around the country.',
    ],
  },
  // Briefs
  { publicationId: 'spec-brief-ballina', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(24, 6), fictional: true, headline: 'Ballina club opens new stalls', pictureTerms: [], paragraphs: ['The Ballina club opened 24 new stalls on Monday, funded by a $420,000 infrastructure grant. The club said the stalls would let it host an extra meeting each year.'] },
  { publicationId: 'spec-brief-hawkesbury', section: 'Integrity & Governance', byline: 'Agent 1', publishedAt: day(23, 6), fictional: true, headline: 'Whip rule reminder issued', pictureTerms: [], paragraphs: ['Stewards reminded jockeys that the limit of five strikes before the final 100 metres still applies in races of 1000 metres or less, after three breaches at Hawkesbury.'] },
  { publicationId: 'spec-brief-sales', section: 'Business & Bloodstock', byline: 'Agent 3', publishedAt: day(22, 6), fictional: true, headline: 'Online sale clears 84 per cent', pictureTerms: [], paragraphs: ['A weekly online sale of tried horses cleared 84 per cent of its 43 lots, with a four-year-old gelding topping the sale at $61,000.'] },
  { publicationId: 'spec-brief-canberra', section: 'People & Stables', byline: 'Agent 2', publishedAt: day(21, 6), fictional: true, headline: 'Canberra jockey returns from injury', pictureTerms: [], paragraphs: ['A Canberra-based jockey who broke her collarbone in June rode her first winner since returning, and said she had “never been so happy to be sore”.'] },
  { publicationId: 'spec-brief-dubai', section: 'International', byline: 'Agent 4', publishedAt: day(20, 6), fictional: true, headline: 'Dubai invitations due next month', pictureTerms: [], paragraphs: ['Invitations for the Dubai spring carnival will be issued next month. Australian connections have until the end of October to lodge interest.'] },
];

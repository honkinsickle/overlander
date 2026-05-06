import { LocationCard, type LocationCardProps } from "@/components/primitives/location-card";

const PAPER_CDN = "https://app.paper.design/file-assets/01KNTTXWMR13F0Y99G08SQM12D";

const cards: LocationCardProps[] = [
  {
    category: "food",
    title: "Trapper's Diner & Coffee",
    badgeBg: "#3A2A1E",
    badgeBorder: "#E8941F",
    ctaBg: "#3A2A1E",
    ctaBorder: "#996422",
    photoUrl: `${PAPER_CDN}/01KQWRJH3222WRZ83P2DM690XR.jpg`,
    photoOffsetY: -19,
    dayTag: "Day 14 / 0.4 mi on route",
    reliability: { score: 88, label: "Good reliability" },
    cost: {
      primary: "Detour: 25min",
      secondary: "Hours 6:00am - 9:00pm",
      hero: "Adds 1h25m",
      eta: (
        <>
          New ETA at Klamath <br />Falls: 8:43pm
        </>
      ),
    },
    rating: { value: "4.5", count: "(320)" },
    ctaLabel: "Add to Day 14",
  },
  {
    category: "mountain",
    title: "Crater Lake National Park",
    titleColor: "#A6C9F9",
    badgeBg: "#24354F",
    badgeBorder: "#A6C9F9",
    ctaBg: "#24354F",
    ctaBorder: "#A6C9F9",
    photoUrl: `${PAPER_CDN}/78R7DE7V2NKT3G0EDJFF24TDKZ.png`,
    photoOffsetY: 0,
    dayTag: "Day 14 / 12.4 mi off",
    reliability: { score: 94, label: "High reliability" },
    cost: {
      primary: "Detour: 1h28m",
      secondary: "$30 entry · Daily",
      hero: "Adds 1h28m",
      eta: (
        <>
          New ETA at Klamath <br />Falls: 8:46pm
        </>
      ),
    },
    rating: { value: "4.8", count: "(12.4k)" },
    ctaLabel: "Add to Day 14",
  },
  {
    category: "fuel",
    title: "Phillips 66 — Sand Creek",
    badgeBg: "#4E252F",
    badgeBorder: "#FA9D9D",
    ctaBg: "#4E252F",
    ctaBorder: "#FA9D9D",
    photoUrl: `${PAPER_CDN}/01KQXV9G61YCZMTFTBQ7FPX7X1.png`,
    photoOffsetY: 0,
    dayTag: "Day 14 / 0.8 mi off",
    reliability: { score: 95, label: "Live pricing" },
    cost: {
      primary: "Detour: 4min",
      secondary: "Diesel · Premium",
      hero: "$4.39/gal",
      eta: "Updated 18 minutes ago",
    },
    rating: { value: "4.2", count: "(96)" },
    ctaLabel: "Add fuel stop",
  },
  {
    category: "camping",
    title: "Diamond Lake Campground",
    badgeBg: "#304C4B",
    badgeBorder: "#6ECECE",
    ctaBg: "#304C4B",
    ctaBorder: "#6ECECE",
    photoUrl: `${PAPER_CDN}/01KQXV7RGFDADF3EDNVB4THDV5.png`,
    photoOffsetY: 0,
    dayTag: "Day 14 / 18 mi south",
    reliability: { score: 91, label: "High reliability" },
    cost: {
      primary: "Detour: 32min",
      secondary: "Sites: 4 of 28 left",
      hero: "Arrive 5:36pm",
      eta: "Arrive Diamond Lake 8:42pm",
    },
    rating: { value: "4.3", count: "(215)" },
    ctaLabel: "Add Campground",
  },
  {
    category: "urban",
    title: "Crater Lake Lodge",
    titleColor: "#6ECECE",
    badgeBg: "#304C4B",
    badgeBorder: "#6ECECE",
    ctaBg: "#304C4B",
    ctaBorder: "#6ECECE",
    photoUrl: `${PAPER_CDN}/01KQXV5T5YSZB5SS6WBTC1PX0M.png`,
    photoOffsetY: 0,
    emoji: "🏨",
    dayTag: "Day 14 / on route",
    reliability: { score: 96, label: "High reliability" },
    cost: {
      secondary: "Check-in until 11 PM",
      hero: "Arrive 7:30pm",
      eta: "Free cancellation",
    },
    rating: { value: "4.7", count: "(842)" },
    ctaLabel: "Add Lodging",
  },
  {
    category: "urban",
    title: "Klamath Falls, OR",
    titleColor: "#E8CF4D",
    badgeBg: "#726207",
    badgeBorder: "#E8CF4D",
    ctaBg: "#726207",
    ctaBorder: "#E8CF4D",
    photoUrl: `${PAPER_CDN}/01KQXWN6ZC3T2VGR430QM8EHYH.png`,
    photoOffsetY: 0,
    emoji: "🚕",
    dayTag: "Day 14 / end of day",
    reliability: { score: 92, label: "High reliability" },
    cost: {
      primary: "Pop: 22,000",
      secondary: "Elev: 4,099 ft",
      hero: "Arrive 9:14pm",
      eta: "4 fuel · 12 food · 8 hotels",
    },
    rating: { value: "4.0", count: "(1.2k)" },
    ctaLabel: "Add to Day 14",
  },
];

export default function LocationCardDemoPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg-base, #0a0b0c)",
        padding: 32,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 300px))",
          gap: 24,
          justifyContent: "center",
        }}
      >
        {cards.map((c, i) => (
          <LocationCard key={i} {...c} />
        ))}
      </div>
    </main>
  );
}

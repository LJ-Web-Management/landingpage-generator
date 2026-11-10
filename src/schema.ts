import * as z from "zod/v4";

/**
 * Facts Claude extracts from a course page. Missing values are empty strings or
 * empty arrays (not null), which keeps the structured-output schema simple and the
 * downstream prompts easy to read.
 */
export const CourseFactsSchema = z.object({
  title: z.string().describe("Official course title as shown on the page"),
  tagline: z
    .string()
    .describe("One-line hook of at most 15 words, grounded in what the page says"),
  summary: z.string().describe("2-4 sentence plain-language overview of the course"),
  price: z.string().describe('Single-seat price exactly as shown, e.g. "$29.99"; empty if not shown'),
  bulk_pricing: z
    .array(z.object({ seats: z.string(), price: z.string() }))
    .describe('Team/bulk price tiers, e.g. {seats: "2-10", price: "$29.69"}; deduplicated'),
  duration: z.string().describe('Course length, e.g. "1 hour"'),
  ceu: z.string().describe("CEU credits if stated"),
  delivery: z.string().describe('How it is delivered, e.g. "100% online, self-paced, 24/7"'),
  languages: z.array(z.string()),
  regulations: z
    .array(z.string())
    .describe('Regulations and standards the course covers, e.g. "29 CFR 1910.147"'),
  certificate: z.string().describe("What certificate the learner gets and how long it is valid"),
  access: z.string().describe("Access period / completion timeline"),
  audience: z.array(z.string()).describe("Who should take the course (job roles, industries)"),
  benefits: z.array(z.string()).describe("Reasons to choose this course, as stated on the page"),
  learning_objectives: z.array(z.string()),
  syllabus: z
    .array(z.object({ module: z.string(), topics: z.array(z.string()) }))
    .describe("Course outline at module level, at most 8 topics per module"),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  testimonials: z
    .array(z.object({ quote: z.string(), name: z.string(), role: z.string() }))
    .describe("Genuine customer testimonials shown on the page, quoted verbatim; empty if none"),
  provider: z.object({
    name: z.string(),
    phone: z.string(),
    website: z.string(),
    logo_url: z.string().describe("Absolute URL of the provider logo if found, else empty"),
    rating: z.string().describe('Average rating, e.g. "4.8"'),
    review_count: z.string(),
    trust_points: z
      .array(z.string())
      .describe("Accreditations, ratings, customer counts and guarantees stated on the page"),
  }),
  course_image_url: z.string().describe("Absolute URL of the main course image if found, else empty"),
  enroll_url: z.string().describe("Where the visitor should go to enroll; the course URL if unsure"),
  extra_facts: z.array(z.string()).describe("Other concrete, useful facts not captured above"),
});

export type CourseFacts = z.infer<typeof CourseFactsSchema>;

export function parseCourseFactsJson(text: string): CourseFacts {
  const data: unknown = JSON.parse(text);
  const result = CourseFactsSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? first.path.join(".") : "(root)";
    throw new Error(`Course details JSON is invalid at ${where}: ${first?.message ?? "unknown error"}`);
  }
  return result.data;
}

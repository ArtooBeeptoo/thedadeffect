import { defineCollection, z } from 'astro:content';

const stories = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),
    heroImage: z.string().optional(),
    heroAlt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { stories };

import { assert, assertEquals } from "@std/assert";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  clearVectorStore,
  initializeCourseVectorStore,
  searchCourses,
} from "../src/rag/course-retriever.ts";
import { sampleData } from "./helpers.ts";

// Word-count vectors stand in for OpenAI: similarity follows shared words, with no key or network
function wordVector(text: string): number[] {
  const vector = new Array(512).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let bucket = 0;
    for (const letter of word) {
      bucket = (bucket * 31 + letter.charCodeAt(0)) % vector.length;
    }
    vector[bucket] += 1;
  }
  return vector;
}

const localEmbeddings: EmbeddingsInterface = {
  embedQuery: (text) => Promise.resolve(wordVector(text)),
  embedDocuments: (texts) => Promise.resolve(texts.map(wordVector)),
};

async function useLocalEmbeddings() {
  clearVectorStore();
  await initializeCourseVectorStore(sampleData, localEmbeddings);
}

Deno.test("searchCourses gives the best match the highest relevance score", async () => {
  await useLocalEmbeddings();

  const { courses } = await searchCourses(
    "machine learning neural networks",
    sampleData,
  );

  assertEquals(courses[0].courseId, "CENG350");
  assert(courses[0].relevanceScore > courses[1].relevanceScore);
});

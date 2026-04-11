#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { Command } from "commander";
import * as readline from "readline";
import { Brain, OpenAICompatibleAdapter, OpenAICompatibleEmbeddingAdapter } from "@the-brain/core";
import { MongoStorageAdapter, connectDB } from "@the-brain/adapter-mongo";
import mongoose from "mongoose";
import { chunkText, parsePdf, collectFiles, basename } from "./ingest.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const USER_ID = process.env.BRAIN_USER_ID ?? "default";

const LLM_URL = process.env.LLM_API_URL ?? "http://localhost:11434/v1/chat/completions";
const LLM_MODEL = process.env.LLM_MODEL ?? "llama3.2";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "local";

const EMBEDDING_URL = process.env.EMBEDDING_API_URL ?? "http://localhost:11434/v1/embeddings";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";

// ─── Brain ────────────────────────────────────────────────────────────────────

const brain = new Brain(
  new OpenAICompatibleAdapter(LLM_URL, LLM_MODEL, LLM_API_KEY),
  new MongoStorageAdapter(),
  new OpenAICompatibleEmbeddingAdapter(EMBEDDING_URL, EMBEDDING_MODEL),
);

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setup() {
  await connectDB();
  await brain.loadActions();
}

async function teardown() {
  await mongoose.disconnect();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("brain")
  .description("The Brain — local-first cognitive memory framework")
  .version("0.1.0");

program
  .command("process <text>")
  .description("Classify intent, save to vault, and respond")
  .action(async (text: string) => {
    await setup();
    try {
      const result = await brain.process(USER_ID, text);
      console.log(`[${result.action}] ${result.answer}`);
    } finally {
      await teardown();
    }
  });

program
  .command("save <text>")
  .description("Save text directly to vault")
  .option("--permanent", "Mark as permanent — never decays or gets pruned")
  .action(async (text: string, options: { permanent?: boolean }) => {
    await setup();
    try {
      const entry = await brain.save(USER_ID, text, options.permanent ?? false);
      const flag = options.permanent ? " [PERMANENT]" : "";
      console.log(`Saved [${entry._id}]${flag}`);
    } finally {
      await teardown();
    }
  });

program
  .command("recall <text>")
  .description("Search memory and return synaptic context")
  .action(async (text: string) => {
    await setup();
    try {
      const { synapticTree, hasContext } = await brain.recall(USER_ID, text);
      if (!hasContext) {
        console.log("No relevant memories found.");
      } else {
        console.log(synapticTree);
      }
    } finally {
      await teardown();
    }
  });

program
  .command("maintenance")
  .description("Run nightly maintenance (decay, pruning, consolidation)")
  .action(async () => {
    await setup();
    try {
      const { subStats, consciousStats } = await brain.runMaintenance();
      console.log(`Subconscious: -${subStats.decayed} decayed, -${subStats.pruned} pruned`);
      console.log(`Conscious:    +${consciousStats.synapsesCreated} synapses`);
    } finally {
      await teardown();
    }
  });

program
  .command("chat", { isDefault: true })
  .description("Interactive chat with The Brain")
  .action(async () => {
    await setup();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('🧠 The Brain — type your message, Ctrl+C to exit\n');

    const ask = () => {
      rl.question('You: ', async (input) => {
        const text = input.trim();
        if (!text) { ask(); return; }

        try {
          const result = await brain.process(USER_ID, text);
          console.log(`\nBrain: ${result.answer}\n`);
        } catch (err) {
          console.error('Error:', err);
        }

        ask();
      });
    };

    rl.on('close', async () => {
      console.log('\nBye.');
      await teardown();
      process.exit(0);
    });

    ask();
  });

// ─── Ingest command ───────────────────────────────────────────────────────────

program
  .command("ingest <path>")
  .description("Ingest PDF file(s) as permanent memory")
  .option("--chunk-size <n>", "Characters per chunk", "600")
  .option("--overlap <n>", "Overlap between chunks", "100")
  .action(async (input: string, options: { chunkSize: string; overlap: string }) => {
    await setup();
    try {
      const files = collectFiles(input);
      if (files.length === 0) {
        console.log("No PDF files found.");
        return;
      }

      const chunkSize = parseInt(options.chunkSize, 10);
      const overlap = parseInt(options.overlap, 10);
      let totalChunks = 0;

      for (const filePath of files) {
        const name = basename(filePath);
        console.log(`\nIngesting: ${name}`);

        const { text, pages } = await parsePdf(filePath);
        const chunks = chunkText(text, chunkSize, overlap);

        console.log(`  ${pages} pages → ${chunks.length} chunks`);

        for (let i = 0; i < chunks.length; i++) {
          const content = `[PDF: ${name}, chunk ${i + 1}/${chunks.length}]\n${chunks[i]}`;
          await brain.save(USER_ID, content, true);
          process.stdout.write(`\r  Saved ${i + 1}/${chunks.length}`);
        }

        console.log(`\n  Done.`);
        totalChunks += chunks.length;
      }

      console.log(`\nIngested ${files.length} file(s), ${totalChunks} chunks total. All permanent.`);
    } finally {
      await teardown();
    }
  });

program.parse();

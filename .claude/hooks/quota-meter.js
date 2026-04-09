#!/usr/bin/env node

const fs = require("fs");
const { execSync } = require("child_process");

let input = "";

process.stdin.on("data", chunk => {
  input += chunk;
});

process.stdin.on("end", () => {
  const event = JSON.parse(input);

  const prompt = event.prompt || "";
  const model = (event.model || "").toLowerCase();

  const promptTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.max(Math.ceil(promptTokens * 0.5), 200);

  let contextTokens = 0;
  let remainingQuota = 100;

  try {
    const context = execSync("claude /context", { encoding: "utf8" });
    const match = context.replace(/,/g, "").match(/(\d+)\s*tokens/i);
    if (match) contextTokens = parseInt(match[1], 10);
  } catch {}

  try {
    const usage = execSync("claude /usage", { encoding: "utf8" });
    const match = usage.match(/(\d+)%/);
    if (match) remainingQuota = parseInt(match[1], 10);
  } catch {}

  let fileTokens = 0;
  for (const file of event.attachments || []) {
    try {
      const size = fs.statSync(file.path).size;
      fileTokens += Math.ceil(size / 4);
    } catch {}
  }

  let multiplier = 1;
  if (model.includes("opus")) multiplier = 2.5;
  if (model.includes("thinking")) multiplier *= 1.4;

  const weightedTokens =
    (promptTokens + contextTokens + fileTokens + outputTokens) * multiplier;

  const estimatedCost = Math.min((weightedTokens / 3000000) * 100, 100);
  const remainingAfter = Math.max(remainingQuota - estimatedCost, 0);

  const message =
    `[Quota Meter] ${estimatedCost.toFixed(1)}% estimated • ` +
    `${remainingAfter.toFixed(1)}% after send\n` +
    `Prompt: ${promptTokens}t | Context: ${contextTokens}t | ` +
    `Files: ${fileTokens}t | Output: ${outputTokens}t`;

  console.log(
    JSON.stringify({
      continue: true,
      systemMessage: message
    })
  );
});
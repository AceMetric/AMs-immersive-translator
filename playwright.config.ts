import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',workers:1,timeout:90000,reporter:'list',use:{actionTimeout:10000,trace:'retain-on-failure'},outputDir:'test-results'});

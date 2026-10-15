import type { Page } from '@playwright/test'

export async function projectAction(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Projeto ▾', exact: true })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.getByRole('button', { name, exact: true }).click()
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
}

export async function openAdvancedEditor(page: Page) {
  const toggle = page.getByRole('button', { name: 'Editor avançado', exact: true })
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
  await page.getByText('Opções de criação', { exact: true }).click()
}

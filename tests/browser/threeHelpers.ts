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

/** Esc opens the pause menu (or does nothing over an outcome screen); leaving goes through its exit button. */
export async function leaveGame(page: Page) {
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await page.keyboard.press('Escape')
  await hud.getByRole('button', { name: /^Sair( do jogo)?$/ }).first().click()
  await hud.waitFor({ state: 'hidden' })
}

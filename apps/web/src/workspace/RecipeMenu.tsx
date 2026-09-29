import { useEffect, useState } from 'react'

import { listRecipes, saveRecipe, type Recipe } from '../api/client.ts'
import type { ModelSpec } from '../../../../packages/domain/ts/src/model-spec.ts'

interface RecipeMenuProps {
  readonly modelSpec: ModelSpec | null
  readonly isBusy: boolean
  readonly applyRecipe: (recipe: Recipe) => void
}

function RecipeMenu({ modelSpec, isBusy, applyRecipe }: RecipeMenuProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    void listRecipes(query)
      .then((items) => { if (active) { setRecipes(items); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [query])

  const saveCurrent = async () => {
    if (!modelSpec || modelSpec.revision === 0) return
    const name = window.prompt('Name this reusable recipe:', modelSpec.scene.title)
    if (!name?.trim()) return
    setIsSaving(true)
    try {
      const saved = await saveRecipe(modelSpec.projectId, modelSpec.revision, name.trim())
      setRecipes((current) => [saved, ...current])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const canApply = modelSpec !== null && modelSpec.objects.length === 0 && !isBusy

  return (
    <details className="recipe-menu">
      <summary>Recipes</summary>
      <div className="recipe-menu__body">
        <label>
          Search recipes
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} />
        </label>
        <div className="recipe-menu__list">
          {recipes.map((recipe) => (
            <button key={recipe.id} type="button" disabled={!canApply || recipe.units !== modelSpec?.units || recipe.displayScale !== modelSpec?.scene.displayScale} onClick={() => applyRecipe(recipe)}>
              {recipe.name} · {recipe.objectCount} parts
            </button>
          ))}
          {recipes.length === 0 && !error && <span>No recipes found.</span>}
        </div>
        {!canApply && <small>Start an empty project to apply a recipe.</small>}
        <button type="button" disabled={!modelSpec || modelSpec.revision === 0 || isBusy || isSaving} onClick={() => { void saveCurrent() }}>
          {isSaving ? 'Saving…' : 'Save current model as recipe'}
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
    </details>
  )
}

export default RecipeMenu

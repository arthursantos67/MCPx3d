export function requestedCadComponentCount(request: string): number | undefined {
  const words: Readonly<Record<string, number>> = { dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
  const count = /(?<![\d–-])\b([2-8]|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|two|three|four|five|six|seven|eight)\s+(?:pe[çc]as|componentes|corpos|parts|components|bodies)\b/i.exec(request.split('\n\nThe CAD engine')[0])?.[1]?.toLowerCase()
  return count ? words[count] ?? Number(count) : undefined
}

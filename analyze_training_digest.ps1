# Análise Completa do Training Digest
$jsonlPath = "c:\Users\Gabriel\Shadow-Duel\Training Digest\training_digest_1768256264751.jsonl"

Write-Host "Lendo arquivo JSONL..." -ForegroundColor Cyan

# Estruturas para análise
$replays = @{}
$archetypes = @{}
$matchups = @{}
$promptTypes = @{}
$actionTypes = @{}
$phases = @{}
$actors = @{}
$outcomes = @{}
$decisionTimes = @()
$lpRanges = @{player = @(); bot = @()}
$fieldCounts = @{player = @(); bot = @()}
$turns = @()
$openingPatterns = @{win = @{}; loss = @{}}

# Ler todas as linhas
$lineCount = 0
Get-Content $jsonlPath | ForEach-Object {
    $lineCount++
    if ($lineCount % 100 -eq 0) {
        Write-Host "Processando linha $lineCount..." -ForegroundColor Gray
    }
    
    try {
        $entry = $_ | ConvertFrom-Json
        
        # Replay único
        if (-not $replays.ContainsKey($entry.replayId)) {
            $replays[$entry.replayId] = @{
                archetype = $entry.archetype
                matchup = $entry.matchup
                outcome = $entry.outcome.gameResult
                actions = @()
            }
        }
        $replays[$entry.replayId].actions += $entry
        
        # Arquétipos
        if ($entry.archetype) {
            if (-not $archetypes.ContainsKey($entry.archetype)) {
                $archetypes[$entry.archetype] = @{count = 0; wins = 0; losses = 0}
            }
            $archetypes[$entry.archetype].count++
            if ($entry.outcome.gameResult -eq "win") { $archetypes[$entry.archetype].wins++ }
            if ($entry.outcome.gameResult -eq "loss") { $archetypes[$entry.archetype].losses++ }
        }
        
        # Matchups
        if ($entry.matchup) {
            if (-not $matchups.ContainsKey($entry.matchup)) {
                $matchups[$entry.matchup] = 0
            }
            $matchups[$entry.matchup]++
        }
        
        # Prompt Types
        if ($entry.promptType) {
            if (-not $promptTypes.ContainsKey($entry.promptType)) {
                $promptTypes[$entry.promptType] = 0
            }
            $promptTypes[$entry.promptType]++
        }
        
        # Action Types
        if ($entry.chosenAction -and $entry.chosenAction.type) {
            $actionType = $entry.chosenAction.type
            if (-not $actionTypes.ContainsKey($actionType)) {
                $actionTypes[$actionType] = 0
            }
            $actionTypes[$actionType]++
        }
        
        # Fases
        if ($entry.phase) {
            if (-not $phases.ContainsKey($entry.phase)) {
                $phases[$entry.phase] = 0
            }
            $phases[$entry.phase]++
        }
        
        # Actors
        if ($entry.actor) {
            if (-not $actors.ContainsKey($entry.actor)) {
                $actors[$entry.actor] = 0
            }
            $actors[$entry.actor]++
        }
        
        # Decision Times
        if ($entry.decisionTime -and $entry.decisionTime -gt 0) {
            $decisionTimes += $entry.decisionTime
        }
        
        # LP Ranges
        if ($entry.context) {
            if ($entry.context.playerLP) { $lpRanges.player += $entry.context.playerLP }
            if ($entry.context.botLP) { $lpRanges.bot += $entry.context.botLP }
            if ($entry.context.playerFieldCount) { $fieldCounts.player += $entry.context.playerFieldCount }
            if ($entry.context.botFieldCount) { $fieldCounts.bot += $entry.context.botFieldCount }
        }
        
        # Turns
        if ($entry.turn) {
            $turns += $entry.turn
        }
        
    } catch {
        Write-Host "Erro ao processar linha $lineCount : $_" -ForegroundColor Red
    }
}

Write-Host "`nAnálise concluída! Gerando relatório..." -ForegroundColor Green

# Analisar opening patterns (primeiras 5 ações)
foreach ($replayId in $replays.Keys) {
    $replay = $replays[$replayId]
    $outcome = $replay.outcome
    if ($outcome -and ($outcome -eq "win" -or $outcome -eq "loss")) {
        $firstActions = ($replay.actions | Select-Object -First 5 | ForEach-Object { 
            "$($_.chosenAction.type):T$($_.turn)" 
        }) -join " → "
        
        if (-not $openingPatterns[$outcome].ContainsKey($firstActions)) {
            $openingPatterns[$outcome][$firstActions] = 0
        }
        $openingPatterns[$outcome][$firstActions]++
    }
}

# Gerar relatório markdown
$report = @()
$report += "# Relatório de Análise: Training Digest Shadow Duel"
$report += ""
$report += "**Arquivo:** ``training_digest_1768256264751.jsonl``"
$report += "**Total de linhas processadas:** $lineCount"
$report += "**Data da análise:** $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
$report += ""
$report += "---"
$report += ""
$report += "## 1. Estatísticas Gerais"
$report += ""
$report += "### Replays"
$report += "- **Total de replays únicos:** $($replays.Count)"
$report += "- **Total de decisões registradas:** $lineCount"
$report += ""
$report += "### Distribuição por Arquétipo"

foreach ($arch in ($archetypes.GetEnumerator() | Sort-Object -Property {$_.Value.count} -Descending)) {
    $winRate = if ($arch.Value.wins + $arch.Value.losses -gt 0) {
        [math]::Round(($arch.Value.wins / ($arch.Value.wins + $arch.Value.losses)) * 100, 1)
    } else { 0 }
    $report += "`n- **$($arch.Key):** $($arch.Value.count) decisões | Win Rate: $winRate% ($($arch.Value.wins)W / $($arch.Value.losses)L)"
}

$report += @"

### Distribuição de Resultados (Replays)
"@

$winReplays = ($replays.Values | Where-Object { $_.outcome -eq "win" }).Count
$lossReplays = ($replays.Values | Where-Object { $_.outcome -eq "loss" }).Count
$nullReplays = ($replays.Values | Where-Object { $null -eq $_.outcome -or $_.outcome -eq "" }).Count
$totalOutcomes = $winReplays + $lossReplays

$winRateOverall = if ($totalOutcomes -gt 0) {
    [math]::Round(($winReplays / $totalOutcomes) * 100, 1)
} else { 0 }

$report += @"

- **Vitórias:** $winReplays ($winRateOverall%)
- **Derrotas:** $lossReplays ($([math]::Round(100 - $winRateOverall, 1))%)
- **Sem resultado:** $nullReplays

---

## 2. Padrões de Decisão

### Tipos de Prompt Mais Comuns
"@

foreach ($pt in ($promptTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $pct = [math]::Round(($pt.Value / $lineCount) * 100, 1)
    $report += "`n- **$($pt.Key):** $($pt.Value) ($pct%)"
}

$report += @"

### Distribuição de Ações Escolhidas (chosenAction.type)
"@

foreach ($at in ($actionTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 15)) {
    $pct = [math]::Round(($at.Value / $lineCount) * 100, 1)
    $report += "`n- **$($at.Key):** $($at.Value) ($pct%)"
}

$report += @"

### Distribuição por Ator
"@

foreach ($act in ($actors.GetEnumerator() | Sort-Object -Property Value -Descending)) {
    $pct = [math]::Round(($act.Value / $lineCount) * 100, 1)
    $report += "`n- **$($act.Key):** $($act.Value) ($pct%)"
}

---

## 3. Contexto de Jogo

### Life Points (LP)
"@

$playerLPStats = $lpRanges.player | Measure-Object -Average -Minimum -Maximum
$botLPStats = $lpRanges.bot | Measure-Object -Average -Minimum -Maximum

$report += @"

- **Player LP:**
  - Média: $([math]::Round($playerLPStats.Average, 0))
  - Mínimo: $($playerLPStats.Minimum)
  - Máximo: $($playerLPStats.Maximum)
- **Bot LP:**
  - Média: $([math]::Round($botLPStats.Average, 0))
  - Mínimo: $($botLPStats.Minimum)
  - Máximo: $($botLPStats.Maximum)

### Field Count (Monstros no Campo)
"@

$playerFieldStats = $fieldCounts.player | Measure-Object -Average -Minimum -Maximum
$botFieldStats = $fieldCounts.bot | Measure-Object -Average -Minimum -Maximum

$report += @"

- **Player Field:**
  - Média: $([math]::Round($playerFieldStats.Average, 2))
  - Mínimo: $($playerFieldStats.Minimum)
  - Máximo: $($playerFieldStats.Maximum)
- **Bot Field:**
  - Média: $([math]::Round($botFieldStats.Average, 2))
  - Mínimo: $($botFieldStats.Minimum)
  - Máximo: $($botFieldStats.Maximum)

---

## 4. Timing Patterns

### Distribuição por Fase
"@

foreach ($ph in ($phases.GetEnumerator() | Sort-Object -Property Value -Descending)) {
    $pct = [math]::Round(($ph.Value / $lineCount) * 100, 1)
    $report += "`n- **$($ph.Key):** $($ph.Value) ($pct%)"
}

### Decision Time
"@

if ($decisionTimes.Count -gt 0) {
    $dtStats = $decisionTimes | Measure-Object -Average -Minimum -Maximum
    $report += @"

- **Total de decisões com timing:** $($decisionTimes.Count)
- **Média:** $([math]::Round($dtStats.Average, 0)) ms
- **Mínimo:** $($dtStats.Minimum) ms
- **Máximo:** $($dtStats.Maximum) ms
- **Mediana:** $([math]::Round(($decisionTimes | Sort-Object)[$decisionTimes.Count / 2], 0)) ms
"@
} else {
    $report += "`n- Sem dados de decision time disponíveis."
}

$report += @"

### Distribuição de Turnos
"@

if ($turns.Count -gt 0) {
    $turnStats = $turns | Measure-Object -Average -Minimum -Maximum
    $report += @"

- **Média de turno:** $([math]::Round($turnStats.Average, 1))
- **Turno mínimo:** $($turnStats.Minimum)
- **Turno máximo:** $($turnStats.Maximum)
"@
}

$report += @"

---

## 5. Matchups

### Combinações Mais Frequentes
"@

foreach ($mu in ($matchups.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $report += "`n- **$($mu.Key):** $($mu.Value) decisões"
}

$report += @"

---

## 6. Opening Patterns

### Top 10 Aberturas em Vitórias
"@

$topWinOpening = $openingPatterns.win.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10
foreach ($pattern in $topWinOpening) {
    $report += "`n- **$($pattern.Value)x:** ``$($pattern.Key)``"
}

$report += @"

### Top 10 Aberturas em Derrotas
"@

$topLossOpening = $openingPatterns.loss.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10
foreach ($pattern in $topLossOpening) {
    $report += "`n- **$($pattern.Value)x:** ``$($pattern.Key)``"
}

$report += @"

---

## 7. Insights Principais

### 🎯 Observações Chave

1. **Decisões Mais Comuns:**
   - A fase com mais decisões é **$((($phases.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key))**
   - O tipo de ação mais frequente é **$((($actionTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key))**

2. **Timing de Decisão:**
   - Decisões variam de $($dtStats.Minimum)ms a $($dtStats.Maximum)ms
   - Média de $([math]::Round($dtStats.Average / 1000, 1))s por decisão

3. **Controle de Board:**
   - Players mantêm em média $([math]::Round($playerFieldStats.Average, 1)) monstros no campo
   - Bots mantêm em média $([math]::Round($botFieldStats.Average, 1)) monstros no campo

4. **Duração de Jogos:**
   - Jogos vão do turno $($turnStats.Minimum) até o turno $($turnStats.Maximum)
   - Média de $([math]::Round($turnStats.Average, 1)) turnos

5. **Win Rate Geral:**
   - Taxa de vitória: **$winRateOverall%** em $totalOutcomes jogos completos

---

## 📊 Recomendações para Training

1. **Balanceamento:** Win rate de $winRateOverall% indica $(if ($winRateOverall -gt 55) { "necessidade de ajuste na dificuldade do bot" } elseif ($winRateOverall -lt 45) { "bot muito forte, considerar ajustes" } else { "boa balanceamento" })

2. **Diversidade de Decisões:** $($promptTypes.Count) tipos diferentes de prompts detectados

3. **Opening Book:** Identificados $($openingPatterns.win.Count) padrões únicos de abertura em vitórias

---

*Relatório gerado automaticamente*
"@

# Salvar relatório
$reportPath = "c:\Users\Gabriel\Shadow-Duel\Training Digest\training_analysis_report.md"
$report | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "`n✅ Relatório salvo em: $reportPath" -ForegroundColor Green
Write-Host "Total de linhas processadas: $lineCount" -ForegroundColor Cyan
Write-Host "Total de replays únicos: $($replays.Count)" -ForegroundColor Cyan

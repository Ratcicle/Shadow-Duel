# Script de Análise - Training Digest Shadow Duel
$jsonlPath = "c:\Users\Gabriel\Shadow-Duel\Training Digest\training_digest_1768256264751.jsonl"

Write-Host "Iniciando análise..." -ForegroundColor Cyan

# Contadores
$replays = @{}
$archetypes = @{}
$matchups = @{}
$promptTypes = @{}
$actionTypes = @{}
$phases = @{}
$actors = @{}
$decisionTimes = @()
$playerLP = @()
$botLP = @()
$playerField = @()
$botField = @()
$turns = @()
$openWin = @{}
$openLoss = @{}

# Processar arquivo
$lineNum = 0
Get-Content $jsonlPath | ForEach-Object {
    $lineNum++
    if ($lineNum % 200 -eq 0) { Write-Host "Linha $lineNum..." -ForegroundColor Gray }
    
    $j = $_ | ConvertFrom-Json
    
    # Replays únicos
    if (-not $replays.ContainsKey($j.replayId)) {
        $replays[$j.replayId] = @{arch=$j.archetype; match=$j.matchup; out=$j.outcome.gameResult; acts=@()}
    }
    $replays[$j.replayId].acts += $j
    
    # Arquétipos
    if ($j.archetype) {
        if (-not $archetypes.ContainsKey($j.archetype)) {
            $archetypes[$j.archetype] = @{c=0;w=0;l=0}
        }
        $archetypes[$j.archetype].c++
        if ($j.outcome.gameResult -eq "win") { $archetypes[$j.archetype].w++ }
        if ($j.outcome.gameResult -eq "loss") { $archetypes[$j.archetype].l++ }
    }
    
    # Outros contadores
    if ($j.matchup) { 
        if (-not $matchups.ContainsKey($j.matchup)) { $matchups[$j.matchup] = 0 }
        $matchups[$j.matchup]++
    }
    if ($j.promptType) { 
        if (-not $promptTypes.ContainsKey($j.promptType)) { $promptTypes[$j.promptType] = 0 }
        $promptTypes[$j.promptType]++
    }
    if ($j.chosenAction.type) { 
        if (-not $actionTypes.ContainsKey($j.chosenAction.type)) { $actionTypes[$j.chosenAction.type] = 0 }
        $actionTypes[$j.chosenAction.type]++
    }
    if ($j.phase) { 
        if (-not $phases.ContainsKey($j.phase)) { $phases[$j.phase] = 0 }
        $phases[$j.phase]++
    }
    if ($j.actor) { 
        if (-not $actors.ContainsKey($j.actor)) { $actors[$j.actor] = 0 }
        $actors[$j.actor]++
    }
    if ($j.decisionTime -and $j.decisionTime -gt 0) { $decisionTimes += $j.decisionTime }
    if ($j.context.playerLP) { $playerLP += $j.context.playerLP }
    if ($j.context.botLP) { $botLP += $j.context.botLP }
    if ($j.context.playerFieldCount) { $playerField += $j.context.playerFieldCount }
    if ($j.context.botFieldCount) { $botField += $j.context.botFieldCount }
    if ($j.turn) { $turns += $j.turn }
}

# Analisar openings
foreach ($rid in $replays.Keys) {
    $r = $replays[$rid]
    if ($r.out -and ($r.out -eq "win" -or $r.out -eq "loss")) {
        $first5 = ($r.acts | Select-Object -First 5 | ForEach-Object {"$($_.chosenAction.type):T$($_.turn)"}) -join " -> "
        if ($r.out -eq "win") {
            if (-not $openWin.ContainsKey($first5)) { $openWin[$first5] = 0 }
            $openWin[$first5]++
        } else {
            if (-not $openLoss.ContainsKey($first5)) { $openLoss[$first5] = 0 }
            $openLoss[$first5]++
        }
    }
}

# Stats
$winReps = ($replays.Values | Where-Object {$_.out -eq "win"}).Count
$lossReps = ($replays.Values | Where-Object {$_.out -eq "loss"}).Count
$totalGames = $winReps + $lossReps
$winRate = if ($totalGames -gt 0) { [math]::Round(($winReps / $totalGames) * 100, 1) } else { 0 }

$plpStat = $playerLP | Measure-Object -Average -Min -Max
$blpStat = $botLP | Measure-Object -Average -Min -Max
$pfStat = $playerField | Measure-Object -Average -Min -Max
$bfStat = $botField | Measure-Object -Average -Min -Max
$dtStat = $decisionTimes | Measure-Object -Average -Min -Max
$tStat = $turns | Measure-Object -Average -Min -Max

# Gerar report
$out = @()
$out += "# Relatorio de Analise: Training Digest Shadow Duel"
$out += ""
$out += "**Arquivo:** training_digest_1768256264751.jsonl"
$out += "**Linhas processadas:** $lineNum"
$out += "**Data:** $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
$out += ""
$out += "---"
$out += ""
$out += "## 1. Estatisticas Gerais"
$out += ""
$out += "### Replays"
$out += "- Total de replays unicos: $($replays.Count)"
$out += "- Total de decisoes: $lineNum"
$out += ""
$out += "### Resultados"
$out += "- Vitorias: $winReps ($winRate%)"
$out += "- Derrotas: $lossReps ($([math]::Round(100-$winRate,1))%)"
$out += ""
$out += "### Distribuicao por Arquetipo"
foreach ($a in ($archetypes.GetEnumerator() | Sort-Object -Property {$_.Value.c} -Descending)) {
    $wr = if (($a.Value.w + $a.Value.l) -gt 0) { [math]::Round(($a.Value.w/($a.Value.w+$a.Value.l))*100,1) } else {0}
    $out += "- **$($a.Key)**: $($a.Value.c) decisoes | WR: $wr% ($($a.Value.w)W/$($a.Value.l)L)"
}
$out += ""
$out += "---"
$out += ""
$out += "## 2. Padroes de Decisao"
$out += ""
$out += "### Top Prompt Types"
foreach ($p in ($promptTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $pct = [math]::Round(($p.Value/$lineNum)*100,1)
    $out += "- **$($p.Key)**: $($p.Value) ($pct%)"
}
$out += ""
$out += "### Top Action Types"
foreach ($a in ($actionTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 15)) {
    $pct = [math]::Round(($a.Value/$lineNum)*100,1)
    $out += "- **$($a.Key)**: $($a.Value) ($pct%)"
}
$out += ""
$out += "### Atores"
foreach ($ac in ($actors.GetEnumerator() | Sort-Object -Property Value -Descending)) {
    $pct = [math]::Round(($ac.Value/$lineNum)*100,1)
    $out += "- **$($ac.Key)**: $($ac.Value) ($pct%)"
}
$out += ""
$out += "---"
$out += ""
$out += "## 3. Contexto de Jogo"
$out += ""
$out += "### Life Points"
$out += "- **Player LP**: Media: $([math]::Round($plpStat.Average,0)) | Min: $($plpStat.Minimum) | Max: $($plpStat.Maximum)"
$out += "- **Bot LP**: Media: $([math]::Round($blpStat.Average,0)) | Min: $($blpStat.Minimum) | Max: $($blpStat.Maximum)"
$out += ""
$out += "### Field Count"
$out += "- **Player Field**: Media: $([math]::Round($pfStat.Average,2)) | Min: $($pfStat.Minimum) | Max: $($pfStat.Maximum)"
$out += "- **Bot Field**: Media: $([math]::Round($bfStat.Average,2)) | Min: $($bfStat.Minimum) | Max: $($bfStat.Maximum)"
$out += ""
$out += "---"
$out += ""
$out += "## 4. Timing Patterns"
$out += ""
$out += "### Fases"
foreach ($ph in ($phases.GetEnumerator() | Sort-Object -Property Value -Descending)) {
    $pct = [math]::Round(($ph.Value/$lineNum)*100,1)
    $out += "- **$($ph.Key)**: $($ph.Value) ($pct%)"
}
$out += ""
$out += "### Decision Time"
$out += "- Total com timing: $($decisionTimes.Count)"
$out += "- Media: $([math]::Round($dtStat.Average,0)) ms ($([math]::Round($dtStat.Average/1000,1))s)"
$out += "- Min: $($dtStat.Minimum) ms | Max: $($dtStat.Maximum) ms"
$out += ""
$out += "### Turnos"
$out += "- Media: $([math]::Round($tStat.Average,1))"
$out += "- Min: $($tStat.Minimum) | Max: $($tStat.Maximum)"
$out += ""
$out += "---"
$out += ""
$out += "## 5. Matchups"
$out += ""
$out += "### Top Matchups"
foreach ($m in ($matchups.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $out += "- **$($m.Key)**: $($m.Value) decisoes"
}
$out += ""
$out += "---"
$out += ""
$out += "## 6. Opening Patterns"
$out += ""
$out += "### Top 10 Aberturas em Vitorias"
foreach ($op in ($openWin.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $out += "- **$($op.Value)x**: $($op.Key)"
}
$out += ""
$out += "### Top 10 Aberturas em Derrotas"
foreach ($op in ($openLoss.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10)) {
    $out += "- **$($op.Value)x**: $($op.Key)"
}
$out += ""
$out += "---"
$out += ""
$out += "## 7. Insights Principais"
$out += ""
$topPhase = ($phases.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key
$topAction = ($actionTypes.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key
$out += "1. **Fase com mais decisoes**: $topPhase"
$out += "2. **Acao mais frequente**: $topAction"
$out += "3. **Tempo medio de decisao**: $([math]::Round($dtStat.Average/1000,1))s"
$out += "4. **Media de monstros no campo**: Player: $([math]::Round($pfStat.Average,1)) | Bot: $([math]::Round($bfStat.Average,1))"
$out += "5. **Duracao media**: $([math]::Round($tStat.Average,1)) turnos"
$out += "6. **Win rate geral**: $winRate% em $totalGames jogos"
$out += ""
$balanceMsg = if ($winRate -gt 55) {"necessita ajuste (player muito forte)"} elseif ($winRate -lt 45) {"bot muito forte, considerar nerfs"} else {"balanceado"}
$out += "**Balanceamento**: $balanceMsg"
$out += ""
$out += "---"
$out += ""
$out += "*Relatorio gerado automaticamente*"

# Salvar
$reportPath = "c:\Users\Gabriel\Shadow-Duel\Training Digest\training_analysis_report.md"
$out | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "`nConcluido!" -ForegroundColor Green
Write-Host "Relatorio salvo em: $reportPath" -ForegroundColor Cyan
Write-Host "Replays: $($replays.Count) | Decisoes: $lineNum | WinRate: $winRate%" -ForegroundColor Yellow

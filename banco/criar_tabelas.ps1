<#
.SYNOPSIS
    Verifica e cria as tabelas do banco assistencia_tecnica no MySQL.

.DESCRIPTION
    1. Testa a conexão e confirma que o banco já existe (o script nunca cria nem recria o banco).
    2. Compara as tabelas existentes com o esquema esperado (esquema_esperado.json).
    3. Mostra um relatório de divergências. Nada é alterado nem apagado.
    4. Cria SOMENTE as tabelas que faltam, na ordem das dependências (pasta sql\).
    5. Confere de novo as tabelas recém-criadas.

    O script não executa DROP, ALTER, TRUNCATE nem DELETE.

.PARAMETER LoginPath
    Nome guardado com mysql_config_editor (padrão: assistencia).

.PARAMETER Banco
    Nome do banco (padrão: assistencia_tecnica).

.PARAMETER MysqlExe
    Caminho do mysql.exe, se ele não estiver no PATH.

.PARAMETER SomenteVerificar
    Gera apenas o relatório, sem criar nada.

.PARAMETER Sim
    Cria as tabelas faltantes sem perguntar antes.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\criar_tabelas.ps1 -SomenteVerificar

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\criar_tabelas.ps1 -MysqlExe "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
#>
[CmdletBinding()]
param(
    [string]$LoginPath = 'assistencia',
    [string]$Banco = 'assistencia_tecnica',
    [string]$MysqlExe = 'mysql',
    [switch]$SomenteVerificar,
    [switch]$Sim
)

$ErrorActionPreference = 'Stop'
$Raiz = $PSScriptRoot
if (-not $Raiz) { $Raiz = (Get-Location).Path }

# ---------------------------------------------------------------------------
# Executa um comando SQL via mysql.exe (a senha vem do login-path, nunca do script)
# ---------------------------------------------------------------------------
function Invoke-Mysql {
    param(
        [Parameter(Mandatory)][string]$Sql,
        [string]$Schema = ''
    )
    $opcoes = @("--login-path=$LoginPath", '--batch', '--skip-column-names', '--default-character-set=utf8mb4')
    if ($Schema) { $opcoes += "--database=$Schema" }

    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $saida = $Sql | & $MysqlExe @opcoes 2>&1
        $codigo = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $anterior
    }

    $linhas = @($saida | ForEach-Object { "$_" } | Where-Object { $_ -ne '' })
    if ($codigo -ne 0) {
        throw ("O MySQL retornou erro (código $codigo): " + ($linhas -join ' '))
    }
    return $linhas
}

# ---------------------------------------------------------------------------
# Compara UMA tabela existente com o esquema esperado. Devolve a lista de divergências.
# ---------------------------------------------------------------------------
function Test-Tabela {
    param($Tabela)

    $nome = $Tabela.nome
    $div = New-Object System.Collections.Generic.List[string]

    # --- colunas: nome, tipo, aceita NULL, auto_increment ---
    $sqlCol = "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS " +
              "WHERE TABLE_SCHEMA = '$Banco' AND TABLE_NAME = '$nome' ORDER BY ORDINAL_POSITION;"
    $reais = @{}
    foreach ($linha in @(Invoke-Mysql $sqlCol)) {
        $p = $linha -split "`t"
        $reais[$p[0].ToLower()] = @{ Tipo = $p[1].ToLower(); Nulo = ($p[2] -eq 'YES'); Extra = $p[3] }
    }
    foreach ($c in $Tabela.colunas) {
        $r = $reais[$c.nome]
        if ($null -eq $r) { $div.Add("coluna ausente: $($c.nome)"); continue }
        if ($r.Tipo -ne $c.tipo.ToLower()) {
            $div.Add("coluna $($c.nome): tipo esperado $($c.tipo), encontrado $($r.Tipo)")
        }
        if ($r.Nulo -ne [bool]$c.nulo) {
            $esp = if ($c.nulo) { 'aceitar NULL' } else { 'ser NOT NULL' }
            $div.Add("coluna $($c.nome): deveria $esp")
        }
        if ($c.auto -and ($r.Extra -notmatch 'auto_increment')) {
            $div.Add("coluna $($c.nome): deveria ser AUTO_INCREMENT")
        }
    }
    $esperadas = @($Tabela.colunas | ForEach-Object { $_.nome.ToLower() })
    foreach ($k in $reais.Keys) {
        if ($esperadas -notcontains $k) { $div.Add("coluna não prevista no MER: $k") }
    }

    # --- chave primária ---
    $pkReal = @(Invoke-Mysql ("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE " +
        "WHERE TABLE_SCHEMA = '$Banco' AND TABLE_NAME = '$nome' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION;"))
    if ((($pkReal -join ',').ToLower()) -ne ((@($Tabela.pk) -join ',').ToLower())) {
        $div.Add("chave primária esperada ($(@($Tabela.pk) -join ',')), encontrada ($($pkReal -join ','))")
    }

    # --- restrições UNIQUE ---
    $uqReal = @(Invoke-Mysql ("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') " +
        "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = '$Banco' AND TABLE_NAME = '$nome' " +
        "AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY' GROUP BY INDEX_NAME;") | ForEach-Object { $_.ToLower() })
    $uqEsp = @($Tabela.unicas | Where-Object { $_ } | ForEach-Object { $_.ToLower() })
    foreach ($u in $uqEsp) { if ($uqReal -notcontains $u) { $div.Add("falta UNIQUE em ($u)") } }
    foreach ($u in $uqReal) { if ($uqEsp -notcontains $u) { $div.Add("UNIQUE não previsto em ($u)") } }

    # --- chaves estrangeiras ---
    $fkReal = New-Object System.Collections.Generic.List[string]
    $linhasFk = @(Invoke-Mysql ("SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME " +
        "FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '$Banco' AND TABLE_NAME = '$nome' " +
        "AND REFERENCED_TABLE_NAME IS NOT NULL;"))
    foreach ($linha in $linhasFk) {
        $p = $linha -split "`t"
        $fkReal.Add(("{0} -> {1}.{2}" -f $p[0], $p[1], $p[2]).ToLower())
    }
    $fkEsp = New-Object System.Collections.Generic.List[string]
    foreach ($f in @($Tabela.fks | Where-Object { $_ })) {
        $fkEsp.Add(("{0} -> {1}.{2}" -f $f.coluna, $f.ref_tabela, $f.ref_coluna).ToLower())
    }
    foreach ($f in $fkEsp) { if ($fkReal -notcontains $f) { $div.Add("falta FOREIGN KEY: $f") } }
    foreach ($f in $fkReal) { if ($fkEsp -notcontains $f) { $div.Add("FOREIGN KEY não prevista: $f") } }

    # --- ações das chaves estrangeiras (esperado RESTRICT; NO ACTION se comporta igual no InnoDB) ---
    $regras = @(Invoke-Mysql ("SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS " +
        "WHERE CONSTRAINT_SCHEMA = '$Banco' AND TABLE_NAME = '$nome';"))
    foreach ($linha in $regras) {
        $p = $linha -split "`t"
        if (($p[1] -match 'CASCADE|SET') -or ($p[2] -match 'CASCADE|SET')) {
            $div.Add("FOREIGN KEY $($p[0]) usa ON DELETE $($p[1]) / ON UPDATE $($p[2]) (esperado RESTRICT)")
        }
    }

    # --- CHECKs (comparação por nome) ---
    $ckReal = @(Invoke-Mysql ("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS " +
        "WHERE TABLE_SCHEMA = '$Banco' AND TABLE_NAME = '$nome' AND CONSTRAINT_TYPE = 'CHECK';") | ForEach-Object { $_.ToLower() })
    $ckEsp = @($Tabela.checks | Where-Object { $_ } | ForEach-Object { $_.ToLower() })
    foreach ($ck in $ckEsp) { if ($ckReal -notcontains $ck) { $div.Add("falta CHECK (por nome): $ck") } }
    foreach ($ck in $ckReal) { if ($ckEsp -notcontains $ck) { $div.Add("CHECK com nome diferente do previsto: $ck (conferir o conteúdo)") } }

    return $div
}

# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------
$pastaRel = Join-Path $Raiz 'relatorios'
New-Item -ItemType Directory -Force -Path $pastaRel | Out-Null
$arquivoRel = Join-Path $pastaRel ('relatorio_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
Start-Transcript -Path $arquivoRel | Out-Null

try {
    Write-Host '=== Assistência Técnica: verificação e criação de tabelas ===' -ForegroundColor Cyan
    Write-Host "Banco: $Banco | login-path: $LoginPath"
    if ($SomenteVerificar) { Write-Host 'Modo: SOMENTE VERIFICAR (nada será criado)' -ForegroundColor Yellow }

    if (-not (Get-Command $MysqlExe -ErrorAction SilentlyContinue)) {
        throw "mysql.exe não encontrado. Informe o caminho com -MysqlExe ""C:\...\bin\mysql.exe"" ou adicione a pasta bin ao PATH."
    }

    # 1) conexão e versão
    $versaoTexto = @(Invoke-Mysql 'SELECT VERSION();')[0]
    $versao = [version]([regex]::Match($versaoTexto, '^\d+\.\d+\.\d+').Value)
    Write-Host "Conectado. Versão do MySQL: $versaoTexto"
    if ($versao -lt [version]'8.0.16') {
        throw "O MySQL $versaoTexto não aplica CHECK. É necessário 8.0.16 ou superior."
    }

    # 2) o banco precisa existir (nunca é criado aqui)
    $achou = @(Invoke-Mysql "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$Banco';")
    if ($achou.Count -eq 0) {
        throw "O banco '$Banco' não foi encontrado (ou o usuário não tem permissão nele). Este script não cria o banco."
    }

    # 3) esquema esperado e tabelas existentes
    $esquema = Get-Content -Raw -Encoding UTF8 (Join-Path $Raiz 'esquema_esperado.json') | ConvertFrom-Json
    $esperadas = @($esquema.tabelas)
    $nomesEsperados = @($esperadas | ForEach-Object { $_.nome })
    $existentes = @(Invoke-Mysql ("SELECT TABLE_NAME FROM information_schema.TABLES " +
        "WHERE TABLE_SCHEMA = '$Banco' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;"))
    Write-Host ("Tabelas previstas: {0} | tabelas existentes no banco: {1}" -f $esperadas.Count, $existentes.Count)

    # 4) auditoria
    $resultado = New-Object System.Collections.Generic.List[object]
    foreach ($t in $esperadas) {
        if ($existentes -contains $t.nome) {
            $div = @(Test-Tabela $t)
            $situacao = if ($div.Count -eq 0) { 'OK' } else { 'DIVERGENTE' }
            $resultado.Add([pscustomobject]@{ Tabela = $t.nome; Arquivo = $t.arquivo; Situacao = $situacao; Detalhes = $div })
        }
        else {
            $resultado.Add([pscustomobject]@{ Tabela = $t.nome; Arquivo = $t.arquivo; Situacao = 'FALTANTE'; Detalhes = @() })
        }
    }
    $naoPrevistas = @($existentes | Where-Object { $nomesEsperados -notcontains $_ })

    Write-Host ''
    Write-Host '=== Relatório de verificação ===' -ForegroundColor Cyan
    foreach ($r in $resultado) {
        switch ($r.Situacao) {
            'OK'       { Write-Host ('[OK]          ' + $r.Tabela) -ForegroundColor Green }
            'FALTANTE' { Write-Host ('[FALTANTE]    ' + $r.Tabela) -ForegroundColor Yellow }
            default {
                Write-Host ('[DIVERGENTE]  ' + $r.Tabela) -ForegroundColor Red
                foreach ($d in $r.Detalhes) { Write-Host ('      - ' + $d) }
            }
        }
    }
    foreach ($n in $naoPrevistas) { Write-Host ('[NÃO PREVISTA] ' + $n + ' (existe no banco, mas não está no MER)') -ForegroundColor Magenta }

    $faltantes = @($resultado | Where-Object { $_.Situacao -eq 'FALTANTE' })
    $divergentes = @($resultado | Where-Object { $_.Situacao -eq 'DIVERGENTE' })
    Write-Host ''
    $qtdOk = @($resultado | Where-Object { $_.Situacao -eq 'OK' }).Count
    Write-Host ("Resumo: {0} OK | {1} divergente(s) | {2} faltante(s) | {3} não prevista(s)" -f $qtdOk, $divergentes.Count, $faltantes.Count, $naoPrevistas.Count)
    if ($divergentes.Count -gt 0) {
        Write-Host 'Tabelas divergentes NÃO são alteradas por este script. Envie este relatório para decidirmos o ajuste.' -ForegroundColor Yellow
    }

    # 5) criação das tabelas que faltam
    if ($faltantes.Count -eq 0) {
        Write-Host 'Nenhuma tabela a criar.' -ForegroundColor Green
    }
    elseif ($SomenteVerificar) {
        Write-Host 'Modo somente verificar: nenhuma tabela foi criada.' -ForegroundColor Yellow
    }
    else {
        $criar = $true
        if (-not $Sim) {
            $resp = Read-Host ("Criar {0} tabela(s) faltante(s) em '{1}'? (S/N)" -f $faltantes.Count, $Banco)
            $criar = ($resp -match '^[sSyY]')
        }
        if (-not $criar) {
            Write-Host 'Cancelado. Nada foi criado.' -ForegroundColor Yellow
        }
        else {
            foreach ($f in $faltantes) {
                $arquivo = Join-Path (Join-Path $Raiz 'sql') $f.Arquivo
                Write-Host ("Criando {0} ({1}) ..." -f $f.Tabela, $f.Arquivo)
                $sql = Get-Content -Raw -Encoding UTF8 $arquivo
                Invoke-Mysql -Sql $sql -Schema $Banco | Out-Null

                $t = $esperadas | Where-Object { $_.nome -eq $f.Tabela } | Select-Object -First 1
                $div = @(Test-Tabela $t)
                if ($div.Count -eq 0) {
                    Write-Host ("  [OK] {0} criada e conferida." -f $f.Tabela) -ForegroundColor Green
                }
                else {
                    Write-Host ("  [ATENÇÃO] {0} criada, mas a conferência encontrou diferenças:" -f $f.Tabela) -ForegroundColor Red
                    foreach ($d in $div) { Write-Host ('      - ' + $d) }
                }
            }
        }
    }

    Write-Host ''
    Write-Host "Relatório salvo em: $arquivoRel" -ForegroundColor Cyan
}
catch {
    Write-Host ''
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Nenhuma tabela existente foi apagada ou alterada.' -ForegroundColor Red
}
finally {
    Stop-Transcript | Out-Null
}

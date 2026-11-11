import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../app/auth/auth.service';
import { API_BASE_URL } from '../../app/config/api.config';
import { Abatimento, AvaliacaoFinanceira, EventoHistorico, Execucao, Expedicao, Orcamento, OrdemServicoDetalhes, PagamentosOs } from '../../app/models/ordem-servico';
import { montarLinhaTempo, OrdemServicoDetalhePage } from './ordem-servico-detalhe';

const API = 'http://api.teste/api';

function detalhes(alteracoes: Partial<OrdemServicoDetalhes> = {}): OrdemServicoDetalhes {
  return {
    id_os: 2,
    status: 'RECEBIDA',
    data_abertura: '2026-11-01T10:00:00Z',
    data_encerramento: null,
    motivo_encerramento: null,
    tecnico: null,
    equipamento: {
      id_item: 20, tipo_equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron', numero_serie: 'SN1',
      estado_fisico: 'Arranhões', garantia_status: 'PENDENTE', observacoes: null,
    },
    cliente: { id_cliente: 1, nome_razao_social: 'Maria Cliente', telefone: '11999990000', email: 'maria@teste.test' },
    solicitacao: { id_solicitacao: 9, data_abertura: '2026-11-01T09:59:00Z', descricao_inicial: 'Não liga' },
    acessorios: [{ id_acessorio_recebido: 1, id_acessorio: 3, descricao_acessorio: 'Carregador', quantidade: 1, observacoes: null }],
    ...alteracoes,
  };
}

describe('montarLinhaTempo', () => {
  it('orders events chronologically from the existing records', () => {
    const eventos = montarLinhaTempo(
      detalhes({ data_encerramento: '2026-11-05T10:00:00Z', motivo_encerramento: 'Orçamento rejeitado.' }),
      { id_execucao: 1, diagnostico: 'Placa', laudo_tecnico: null, resultado: null, data_inicio: '2026-11-02T10:00:00Z', data_conclusao: null },
      [{
        id_orcamento: 4, data_emissao: '2026-11-03T10:00:00Z', data_validade: '2026-11-06T10:00:00Z', valor_total: '150.00',
        status: 'REJEITADO', resposta: { decisao: 'REJEITADO', data_resposta: '2026-11-04T10:00:00Z', observacoes: null },
      }],
      null,
      null,
    );

    expect(eventos.map((e) => e.titulo)).toEqual([
      'Ordem de Serviço aberta',
      'Análise técnica iniciada',
      'Orçamento nº 4 emitido',
      'Orçamento nº 4 rejeitado pelo cliente',
      'Ordem de Serviço encerrada',
    ]);
  });

  it('skips pending payments (no date yet), shows refunds and the delivery method of the dispatch', () => {
    const pagamento = (alteracoes: object) => ({
      id_pagamento: 1, valor: '100.00', forma_pagamento: 'PIX', status: 'CONFIRMADO', data_pagamento: null,
      data_reembolso: null, id_usuario_reembolso: null, justificativa_reembolso: null, ...alteracoes,
    });
    const eventos = montarLinhaTempo(
      detalhes(),
      null,
      [],
      {
        pagamentos: [
          pagamento({ id_pagamento: 1, status: 'PENDENTE' }),
          pagamento({ id_pagamento: 2, status: 'REEMBOLSADO', data_pagamento: '2026-11-02T10:00:00Z', data_reembolso: '2026-11-03T10:00:00Z', justificativa_reembolso: 'Duplicidade' }),
        ],
        resumo: { tem_orcamento_aprovado: true, total_orcado: 100, total_pago: 0, pagamentos_pendentes: 100, saldo_devedor: 100 },
      },
      {
        id_expedicao: 1, data_envio: null, forma_entrega: 'RETIRADA', codigo_rastreio: null,
        status: 'RETIRADO', data_entrega: '2026-11-04T10:00:00Z',
      },
    );

    // Intl usa espaço não separável depois de "R$": normaliza para comparar
    expect(eventos.map((e) => e.titulo.replace(/\s/g, ' '))).toEqual([
      'Ordem de Serviço aberta',
      'Pagamento de R$ 100,00',
      'Pagamento de R$ 100,00 reembolsado',
      'Equipamento retirado pelo cliente',
    ]);
  });
});

interface Complementos {
  execucao?: Execucao;
  orcamentos?: Orcamento[];
  pagamentos?: PagamentosOs;
  expedicao?: Expedicao;
  historico?: EventoHistorico[];
  avaliacao?: AvaliacaoFinanceira;
  abatimentos?: Abatimento[];
}

const SEM_PAGAMENTOS: PagamentosOs = {
  pagamentos: [], resumo: { tem_orcamento_aprovado: false, total_orcado: 0, total_pago: 0, pagamentos_pendentes: 0, saldo_devedor: 0 },
};

describe('OrdemServicoDetalhePage', () => {
  let fixture: ComponentFixture<OrdemServicoDetalhePage>;
  let backend: HttpTestingController;
  let perfilAtual = '';
  let osAtual: OrdemServicoDetalhes | null = null;

  async function criar(perfil: string, resposta: OrdemServicoDetalhes | 'nao-encontrada', complementos: Complementos = {}) {
    perfilAtual = perfil;
    await TestBed.configureTestingModule({
      imports: [OrdemServicoDetalhePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
        {
          provide: AuthService,
          useValue: {
            possuiPerfil: (...perfis: string[]) => perfis.includes(perfil),
            usuario: () => ({ id_usuario: perfil === 'TECNICO' ? 7 : 2, perfil }),
          },
        },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrdemServicoDetalhePage);
    fixture.componentRef.setInput('id', '2');
    fixture.detectChanges();

    const req = backend.expectOne(`${API}/ordens-servico/2`);
    if (resposta === 'nao-encontrada') {
      req.flush({ mensagem: 'Ordem de serviço não encontrada.' }, { status: 404, statusText: 'Not Found' });
    } else {
      osAtual = resposta;
      req.flush(resposta);
      responderComplementos(complementos);
    }
    fixture.detectChanges();
  }

  /** Responde às consultas complementares da OS 2 (execução, orçamentos, pagamentos, expedição, histórico). */
  function responderComplementos(c: Complementos = {}) {
    const execucao = backend.expectOne(`${API}/ordens-servico/2/execucao`);
    if (c.execucao) execucao.flush(c.execucao);
    else execucao.flush({ mensagem: 'x' }, { status: 404, statusText: 'Not Found' });
    backend.expectOne(`${API}/ordens-servico/2/orcamentos`).flush(c.orcamentos ?? []);
    // P3: o técnico não consulta pagamentos
    if (perfilAtual === 'TECNICO') backend.expectNone(`${API}/ordens-servico/2/pagamentos`);
    else backend.expectOne(`${API}/ordens-servico/2/pagamentos`).flush(c.pagamentos ?? SEM_PAGAMENTOS);
    backend.expectOne(`${API}/ordens-servico/2/expedicao`).flush(c.expedicao ?? null);
    backend.expectOne(`${API}/ordens-servico/2/historico`).flush(c.historico ?? []);
    // D1: avaliação financeira só para ADM/ATD em OS encerrada por impossibilidade técnica
    const avaliacao = `${API}/ordens-servico/2/avaliacao-financeira`;
    if (perfilAtual !== 'TECNICO' && osAtual?.tipo_encerramento === 'IMPOSSIBILIDADE_TECNICA') {
      backend.expectOne(avaliacao).flush(c.avaliacao ?? null);
    } else {
      backend.expectNone(avaliacao);
    }
    // R1 (C2): abatimentos só para ADM/ATD
    const abatimentos = `${API}/ordens-servico/2/abatimentos`;
    if (perfilAtual === 'TECNICO') backend.expectNone(abatimentos);
    else backend.expectOne(abatimentos).flush(c.abatimentos ?? []);
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = () => el().textContent ?? '';

  it('shows equipment, client, request, accessories and the assignment panel to the attendant', async () => {
    await criar('ATENDENTE', detalhes());
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([
      { id_usuario: 7, nome: 'Tecnico Teste', perfil: 'TECNICO', ativo: 1 },
    ]);
    fixture.detectChanges();

    expect(texto()).toContain('OS nº 2');
    expect(texto()).toContain('Sem técnico atribuído');
    expect(texto()).toContain('(11) 99999-0000');
    expect(texto()).toContain('Não liga');
    expect(texto()).toContain('1× Carregador');
    expect(el().querySelector('app-secao-execucao')!.textContent).toContain('Não registrada');
    expect(el().querySelector('#selecao-tecnico')).toBeTruthy();
  });

  it('assigns the selected technician and updates the page', async () => {
    await criar('ADMINISTRADOR', detalhes());
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([
      { id_usuario: 7, nome: 'Tecnico Teste', perfil: 'TECNICO', ativo: 1 },
    ]);
    fixture.detectChanges();

    const select = el().querySelector<HTMLSelectElement>('#selecao-tecnico')!;
    select.value = '7';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Atribuir'))!.click();

    const req = backend.expectOne(`${API}/ordens-servico/2/tecnico`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ id_tecnico: 7 });
    req.flush({ mensagem: 'ok', ordem: detalhes({ tecnico: { id_usuario: 7, nome: 'Tecnico Teste', ativo: true } }) });
    fixture.detectChanges();

    expect(texto()).toContain('Técnico Tecnico Teste atribuído.');
    expect(el().querySelector('.valor')?.textContent).toContain('Tecnico Teste');
  });

  it('warns about an inactive technician and blocks reassignment of closed orders', async () => {
    await criar('ATENDENTE', detalhes({
      status: 'FINALIZADA',
      data_encerramento: '2026-11-06T10:00:00Z',
      tecnico: { id_usuario: 2, nome: 'Tiago', ativo: false },
    }));
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(texto()).toContain('Este técnico está inativo');
    expect(texto()).toContain('A OS está encerrada');
    expect(el().querySelector('#selecao-tecnico')).toBeNull();
  });

  it('technician sees no assignment panel and no request data', async () => {
    const { solicitacao, ...semSolicitacao } = detalhes({
      tecnico: { id_usuario: 7, nome: 'Tecnico Teste', ativo: true },
      cliente: { id_cliente: 1, nome_razao_social: 'Maria Cliente' },
    });
    void solicitacao;
    await criar('TECNICO', semSolicitacao);
    backend.expectNone((r) => r.url === `${API}/usuarios`);

    expect(el().querySelector('#selecao-tecnico')).toBeNull();
    expect(texto()).not.toContain('Problema relatado');
    expect(texto()).toContain('Maria Cliente');
  });

  it('shows "not found" for a 404 (including another technician\'s order)', async () => {
    await criar('TECNICO', 'nao-encontrada');
    expect(texto()).toContain('Ordem de Serviço não encontrada');
  });
  // ---------- Ações de atendimento ----------

  const botao = (rotulo: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === rotulo);
  const preencher = (seletor: string, valor: string) => {
    const campo = el().querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(seletor)!;
    campo.value = valor;
    campo.dispatchEvent(new Event(campo.tagName === 'SELECT' ? 'change' : 'input'));
    fixture.detectChanges();
  };
  /** Depois de uma ação a página recarrega a OS e os complementos. */
  const responderRecarga = (os: OrdemServicoDetalhes, c: Complementos = {}) => {
    osAtual = os;
    backend.expectOne(`${API}/ordens-servico/2`).flush(os);
    responderComplementos(c);
    fixture.detectChanges();
  };
  const tecnico = { id_usuario: 7, nome: 'Tecnico Teste', ativo: true };
  const execucao: Execucao = {
    id_execucao: 1, diagnostico: 'Placa oxidada', laudo_tecnico: null, resultado: null,
    data_inicio: '2026-11-02T10:00:00Z', data_conclusao: null,
  };
  const futuro = '2099-01-01T00:00:00Z';
  /** Troca a OS exibida sem nova requisição (para conferir botões por etapa). */
  const responderRecargaManual = (status: OrdemServicoDetalhes['status']) => {
    fixture.componentInstance.ordem.set(detalhes({ status, tecnico }));
    fixture.detectChanges();
  };

  it('technician records the first diagnosis and the page reloads', async () => {
    const os = detalhes({ tecnico });
    await criar('TECNICO', os);

    preencher('#campo-diagnostico', '  Placa oxidada  ');
    botao('Registrar diagnóstico')!.click();

    const req = backend.expectOne(`${API}/ordens-servico/2/execucao`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ diagnostico: 'Placa oxidada' });
    req.flush({ mensagem: 'ok', execucao });
    responderRecarga({ ...os, status: 'EM_ANALISE' }, { execucao });

    expect(texto()).toContain('Diagnóstico registrado');
    expect(texto()).toContain('Placa oxidada');
  });

  it('attendant does not see the diagnosis form and only reads the warranty (checked by the technician)', async () => {
    const os = detalhes({ status: 'EM_ANALISE', tecnico });
    await criar('ATENDENTE', os, { execucao });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(el().querySelector('#campo-diagnostico')).toBeNull();
    expect(botao('Editar diagnóstico e laudo')).toBeUndefined();
    expect(el().querySelector('input[name="garantia"]')).toBeNull();
    expect(botao('Salvar garantia')).toBeUndefined();
    expect(texto()).toContain('Aguardando a verificação da garantia pelo técnico.');
  });

  it('assigned technician checks the warranty while the order is EM_ANALISE', async () => {
    const os = detalhes({ status: 'EM_ANALISE', tecnico });
    await criar('TECNICO', os, { execucao });

    el().querySelector<HTMLInputElement>('input[name="garantia"][value="NAO"]')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    botao('Salvar garantia')!.click();

    const req = backend.expectOne(`${API}/ordens-servico/2/garantia`);
    expect(req.request.body).toEqual({ garantia_status: 'NAO' });
    req.flush({ mensagem: 'ok' });
    responderRecarga(os, { execucao });
    expect(texto()).toContain('Garantia registrada: Fora da garantia.');
  });

  it('technician cannot change the warranty outside EM_ANALISE', async () => {
    await criar('TECNICO', detalhes({ status: 'AGUARDANDO_APROVACAO', tecnico }), { execucao });
    expect(el().querySelector('input[name="garantia"]')).toBeNull();
    expect(botao('Salvar garantia')).toBeUndefined();
  });

  it('administrator only reads the warranty', async () => {
    await criar('ADMINISTRADOR', detalhes({ status: 'EM_ANALISE', tecnico }), { execucao });
    backend.match((r) => r.url === `${API}/usuarios`).forEach((r) => r.flush([]));
    fixture.detectChanges();
    expect(el().querySelector('input[name="garantia"]')).toBeNull();
  });

  it('technician issues a quote with items; the button is hidden while warranty is PENDENTE', async () => {
    await criar('TECNICO', detalhes({ status: 'EM_ANALISE', tecnico }), { execucao });
    expect(botao('Emitir orçamento')).toBeUndefined();
    expect(texto()).toContain('Verifique a garantia antes de emitir o orçamento.');
  });

  it('warranty SIM still goes through a quote: services at R$ 0,00, parts charged', async () => {
    const os = detalhes({ status: 'EM_ANALISE', tecnico });
    os.equipamento.garantia_status = 'SIM';
    await criar('TECNICO', os, { execucao });

    botao('Emitir orçamento')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('itens de serviço são cobrados a R$ 0,00 (peças continuam cobradas)');
  });

  it('technician fills and sends a new quote', async () => {
    const os = detalhes({ status: 'EM_ANALISE', tecnico });
    os.equipamento.garantia_status = 'NAO';
    await criar('TECNICO', os, { execucao });

    botao('Emitir orçamento')!.click();
    fixture.detectChanges();
    preencher('#item-descricao-0', 'Placa-mãe');
    preencher('#item-valor-0', '250');
    el().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const req = backend.expectOne(`${API}/ordens-servico/2/orcamentos`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ itens: [{ tipo_item: 'PECA', descricao: 'Placa-mãe', quantidade: 1, valor_unitario: 250 }] });
  });

  it('attendant approves the pending quote after confirming', async () => {
    const orcamento: Orcamento = {
      id_orcamento: 5, data_emissao: '2026-11-02T10:00:00Z', data_validade: futuro, valor_total: '250.00', status: 'PENDENTE',
      itens: [{ tipo_item: 'PECA', descricao: 'Placa-mãe', quantidade: 1, valor_unitario: '250.00' }], resposta: null,
    };
    await criar('ATENDENTE', detalhes({ status: 'AGUARDANDO_APROVACAO', tecnico }), { execucao, orcamentos: [orcamento] });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(texto()).toContain('Aguardando resposta');
    expect(texto()).toContain('Placa-mãe');
    botao('Cliente aprovou')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('Registrar a aprovação do cliente?');
    botao('Confirmar aprovação')!.click();

    const req = backend.expectOne(`${API}/orcamentos/5/resposta`);
    expect(req.request.body).toEqual({ decisao: 'APROVADO', observacoes: null });
  });

  it('technician cannot answer a quote', async () => {
    const orcamento: Orcamento = {
      id_orcamento: 5, data_emissao: '2026-11-02T10:00:00Z', data_validade: futuro, valor_total: 10, status: 'PENDENTE', resposta: null,
    };
    await criar('TECNICO', detalhes({ status: 'AGUARDANDO_APROVACAO', tecnico }), { execucao, orcamentos: [orcamento] });
    expect(botao('Cliente aprovou')).toBeUndefined();
  });

  const pagamentos: PagamentosOs = {
    pagamentos: [
      { id_pagamento: 9, data_pagamento: null, valor: '50.00', forma_pagamento: 'PIX', status: 'PENDENTE', data_reembolso: null, id_usuario_reembolso: null, justificativa_reembolso: null },
      { id_pagamento: 8, data_pagamento: '2026-11-03T10:00:00Z', valor: '100.00', forma_pagamento: 'DINHEIRO', status: 'CONFIRMADO', data_reembolso: null, id_usuario_reembolso: null, justificativa_reembolso: null },
    ],
    resumo: { tem_orcamento_aprovado: true, total_orcado: 300, total_pago: 100, pagamentos_pendentes: 50, saldo_devedor: 200 },
  };

  it('attendant sees the backend totals and registers a payment limited to the available balance', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), { execucao, pagamentos });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    const resumo = [...el().querySelectorAll('dl.resumo div')].map((d) => d.textContent!.replace(/\s/g, ' ').trim());
    expect(resumo).toContain('Total devidoR$ 300,00');
    expect(resumo).toContain('Saldo restanteR$ 200,00');

    botao('Registrar pagamento')!.click();
    fixture.detectChanges();
    expect(el().querySelector<HTMLInputElement>('#campo-valor-pagamento')!.value).toBe('150');

    preencher('#campo-valor-pagamento', '180');
    botao('Registrar')!.click();
    fixture.detectChanges();
    backend.expectNone(`${API}/ordens-servico/2/pagamentos`);
    expect(texto()).toContain('Informe um valor entre');

    preencher('#campo-valor-pagamento', '150');
    botao('Registrar')!.click();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `${API}/ordens-servico/2/pagamentos`);
    expect(req.request.body).toEqual({ valor: 150, forma_pagamento: 'PIX' });
  });

  it('attendant confirms a pending payment and refunds a confirmed one with justification', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), { execucao, pagamentos });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    botao('Confirmar recebimento')!.click();
    fixture.detectChanges();
    botao('Confirmar')!.click();
    const confirmacao = backend.expectOne(`${API}/pagamentos/9/status`);
    expect(confirmacao.request.body).toEqual({ status: 'CONFIRMADO' });
    confirmacao.flush({ mensagem: 'ok' });
    responderRecarga(detalhes({ status: 'EM_REPARO', tecnico }), { execucao, pagamentos });

    botao('Reembolsar')!.click();
    fixture.detectChanges();
    botao('Confirmar')!.click();
    fixture.detectChanges();
    backend.expectNone(`${API}/pagamentos/8/reembolso`);
    expect(texto()).toContain('Informe a justificativa do reembolso.');

    preencher('#justificativa-8', 'Cobrança em duplicidade');
    botao('Confirmar')!.click();
    const reembolso = backend.expectOne(`${API}/pagamentos/8/reembolso`);
    // Sem alterar o valor: todo o disponível do pagamento
    expect(reembolso.request.body).toEqual({ justificativa_reembolso: 'Cobrança em duplicidade', valor: 100 });
  });

  it('D6: attendant refunds part of a payment; a value above the available amount is refused locally', async () => {
    const comParcial: PagamentosOs = {
      ...pagamentos,
      pagamentos: [{
        ...pagamentos.pagamentos[1], valor_reembolsado: 30, valor_disponivel_reembolso: 70,
        reembolsos: [{ id_reembolso: 1, id_pagamento: 8, id_avaliacao: null, valor: '30.00', justificativa: 'Peça devolvida', id_usuario: 2, nome_usuario: 'Ana', data_reembolso: '2026-11-04T10:00:00Z' }],
      }],
    };
    await criar('ATENDENTE', detalhes({ status: 'FINALIZADA', tecnico }), { execucao, pagamentos: comParcial });
    expect(texto()).toContain('Peça devolvida');
    expect(texto().replace(/\s/g, ' ')).toContain('disponível para devolução R$ 70,00');

    botao('Reembolsar')!.click();
    fixture.detectChanges();
    expect((el().querySelector('#valor-reembolso-8') as HTMLInputElement).value).toBe('70');
    preencher('#valor-reembolso-8', '70.01');
    preencher('#justificativa-8', 'Restante');
    botao('Confirmar')!.click();
    fixture.detectChanges();
    backend.expectNone(`${API}/pagamentos/8/reembolso`);
    expect(texto().replace(/\s/g, ' ')).toContain('Informe um valor entre R$ 0,01 e R$ 70,00.');

    preencher('#valor-reembolso-8', '20');
    botao('Confirmar')!.click();
    const reembolso = backend.expectOne(`${API}/pagamentos/8/reembolso`);
    expect(reembolso.request.body).toEqual({ justificativa_reembolso: 'Restante', valor: 20 });
  });

  const encerradaImpossibilidade = () => detalhes({
    status: 'ENCERRADA_SEM_REPARO', tecnico, tipo_encerramento: 'IMPOSSIBILIDADE_TECNICA',
    data_encerramento: '2026-11-05T10:00:00Z', motivo_encerramento: 'Peça descontinuada',
  });
  const avaliacaoPendente: AvaliacaoFinanceira = {
    id_os: 2, obrigatoria: true, pendente: true, vigente: null, avaliacoes: [],
    total_disponivel: 100, total_reembolsado_avaliacao: 0, saldo_a_reembolsar: null,
  };

  it('Q1: pending evaluation does not block the return of the equipment; attendant sees the financial notice', async () => {
    await criar('ATENDENTE', encerradaImpossibilidade(), { execucao, pagamentos, avaliacao: avaliacaoPendente });
    const expedicao = el().querySelector('app-secao-expedicao')!;
    expect(expedicao.textContent).toContain('Pendência financeira');
    expect(expedicao.textContent).toContain('A devolução do equipamento pode prosseguir normalmente');
    const registrar = botao('Registrar devolução');
    expect(registrar).toBeDefined();
    expect(registrar!.disabled).toBe(false);
    // O reembolso continua bloqueado até a avaliação
    expect(botao('Reembolsar')!.disabled).toBe(true);

    registrar!.click();
    fixture.detectChanges();
    botao('Registrar')!.click();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `${API}/ordens-servico/2/expedicao`);
    expect(req.request.body.forma_entrega).toBe('RETIRADA');
  });

  it('Q1: the financial notice is not shown once the evaluation exists, nor to the technician', async () => {
    const original = {
      id_avaliacao: 30, id_avaliacao_revisada: null, tipo: 'ORIGINAL' as const, valor_definido: 0, justificativa: 'Sem devolução',
      motivo_revisao: null, id_usuario: 2, nome_usuario: 'Ana', data_avaliacao: '2026-11-05T11:00:00Z',
    };
    await criar('ATENDENTE', encerradaImpossibilidade(), {
      execucao, pagamentos, avaliacao: { ...avaliacaoPendente, pendente: false, vigente: original, avaliacoes: [original], saldo_a_reembolsar: 0 },
    });
    expect(texto()).not.toContain('Pendência financeira');
    TestBed.resetTestingModule();

    await criar('TECNICO', encerradaImpossibilidade(), { execucao });
    expect(texto()).not.toContain('Pendência financeira');
  });

  // ---------- R1: abatimento formal ----------

  const resumoR1 = (alteracoes: Partial<PagamentosOs['resumo']> = {}): PagamentosOs => ({
    pagamentos: [],
    resumo: { tem_orcamento_aprovado: true, total_orcado: 100, total_abatido: 0, total_devido: 100, total_pago: 50, pagamentos_pendentes: 10, saldo_devedor: 50, ...alteracoes },
  });
  const abatimentoR1 = (alteracoes: Partial<Abatimento> = {}): Abatimento => ({
    id_abatimento: 70, id_os: 2, id_orcamento: 5, valor: '20.00', motivo: 'Desconto negociado', status: 'APROVADO',
    id_usuario_registro: 2, nome_usuario_registro: 'Ana', data_registro: '2026-11-05T10:00:00Z',
    id_usuario_cancelamento: null, nome_usuario_cancelamento: null, data_cancelamento: null, justificativa_cancelamento: null,
    ...alteracoes,
  });

  it('U3: settled balance explains why there is no new payment or discount', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), {
      execucao,
      pagamentos: resumoR1({ total_abatido: 70, total_devido: 30, total_pago: 30, pagamentos_pendentes: 0, saldo_devedor: 0 }),
    });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(botao('Registrar pagamento')).toBeUndefined();
    expect(botao('Registrar abatimento')).toBeUndefined();
    expect(texto()).toContain('Saldo quitado: não há valor para registrar um novo pagamento.');
    expect(texto()).toContain('Saldo quitado: não há valor disponível para um novo abatimento.');
  });

  it('U3: balance reserved by pending payments is explained', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), {
      execucao,
      pagamentos: resumoR1({ total_pago: 50, pagamentos_pendentes: 50, saldo_devedor: 50 }),
    });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(texto()).toContain('O saldo restante já está reservado por pagamentos pendentes de confirmação.');
    expect(texto()).not.toContain('Saldo quitado');
  });

  it('R1: attendant registers a discount limited to devido − pago − pendentes, after confirming', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), { execucao, pagamentos: resumoR1() });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();
    expect(texto()).toContain('Não é reembolso');

    botao('Registrar abatimento')!.click();
    fixture.detectChanges();
    expect(texto().replace(/\s/g, ' ')).toContain('Disponível: R$ 40,00');
    preencher('#campo-valor-abatimento', '40.01');
    preencher('#campo-motivo-abatimento', 'Peça recondicionada');
    botao('Continuar')!.click();
    fixture.detectChanges();
    expect(texto().replace(/\s/g, ' ')).toContain('Informe um valor entre R$ 0,01 e R$ 40,00.');
    backend.expectNone(`${API}/ordens-servico/2/abatimentos`);

    preencher('#campo-valor-abatimento', '40');
    botao('Continuar')!.click();
    fixture.detectChanges();
    botao('Confirmar abatimento')!.click();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `${API}/ordens-servico/2/abatimentos`);
    expect(req.request.body).toEqual({ valor: 40, motivo: 'Peça recondicionada' });
  });

  it('R1: summary shows the approved quote, discounts and total due; a cancelled discount keeps its record', async () => {
    await criar('ATENDENTE', detalhes({ status: 'AGUARDANDO_EXPEDICAO', tecnico }), {
      execucao,
      pagamentos: resumoR1({ total_abatido: 20, total_devido: 80, total_pago: 80, pagamentos_pendentes: 0, saldo_devedor: 0 }),
      abatimentos: [
        abatimentoR1(),
        abatimentoR1({ id_abatimento: 71, status: 'CANCELADO', nome_usuario_cancelamento: 'Admin', data_cancelamento: '2026-11-06T10:00:00Z', justificativa_cancelamento: 'Duplicado' }),
      ],
    });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();
    const pag = el().querySelector('app-secao-pagamentos')!.textContent!.replace(/\s/g, ' ');
    expect(pag).toContain('Orçamento aprovado');
    expect(pag).toContain('− R$ 20,00');
    expect(pag).toContain('Total devidoR$ 80,00');
    const ab = el().querySelector('app-secao-abatimentos')!.textContent!;
    expect(ab).toContain('Cancelado');
    expect(ab).toContain('Duplicado');
    // Saldo zero: sem novo abatimento; o aprovado pode ser cancelado (A5); o cancelado não
    expect(botao('Registrar abatimento')).toBeUndefined();
    expect(el().querySelector('button[aria-label="Cancelar abatimento nº 70"]')).not.toBeNull();
    expect(el().querySelector('button[aria-label="Cancelar abatimento nº 71"]')).toBeNull();
  });

  it('R1: cancelling requires a justification and sends it', async () => {
    await criar('ADMINISTRADOR', detalhes({ status: 'CONCLUIDA', tecnico }), { execucao, pagamentos: resumoR1({ total_abatido: 20, total_devido: 80 }), abatimentos: [abatimentoR1()] });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('button[aria-label="Cancelar abatimento nº 70"]')!.click();
    fixture.detectChanges();
    botao('Confirmar cancelamento')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('Informe a justificativa do cancelamento.');
    backend.expectNone(`${API}/abatimentos/70/cancelamento`);
    preencher('#justificativa-abatimento-70', 'Lançado por engano');
    botao('Confirmar cancelamento')!.click();
    const req = backend.expectOne(`${API}/abatimentos/70/cancelamento`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ justificativa: 'Lançado por engano' });
  });

  it('R1: no discount actions on FINALIZADA; the technician never sees discounts', async () => {
    await criar('ATENDENTE', detalhes({ status: 'FINALIZADA', tecnico }), { execucao, pagamentos: resumoR1({ total_abatido: 20, total_devido: 80, total_pago: 80, pagamentos_pendentes: 0, saldo_devedor: 0 }), abatimentos: [abatimentoR1()] });
    expect(botao('Registrar abatimento')).toBeUndefined();
    expect(el().querySelector('button[aria-label="Cancelar abatimento nº 70"]')).toBeNull();
    TestBed.resetTestingModule();

    await criar('TECNICO', detalhes({ status: 'EM_REPARO', tecnico }), { execucao });
    expect(el().querySelector('app-secao-abatimentos')).toBeNull();
    expect(texto()).not.toContain('Abatimento');
  });

  it('D1: pending mandatory evaluation is shown, refunds are blocked and the evaluation is registered after confirming', async () => {
    await criar('ATENDENTE', encerradaImpossibilidade(), { execucao, pagamentos, avaliacao: avaliacaoPendente });
    expect(texto()).toContain('Avaliação obrigatória pendente');
    expect(botao('Reembolsar')!.disabled).toBe(true);

    botao('Registrar avaliação')!.click();
    fixture.detectChanges();
    preencher('#campo-valor-definido', '120');
    preencher('#campo-justificativa-avaliacao', 'Peça já comprada');
    botao('Continuar')!.click();
    fixture.detectChanges();
    expect(texto().replace(/\s/g, ' ')).toContain('Informe um valor entre R$ 0,00 e R$ 100,00.');
    backend.expectNone(`${API}/ordens-servico/2/avaliacao-financeira`);

    // Zero é válido: registra que não haverá devolução
    preencher('#campo-valor-definido', '0');
    botao('Continuar')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('O registro não pode ser editado');
    botao('Confirmar registro')!.click();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `${API}/ordens-servico/2/avaliacao-financeira`);
    expect(req.request.body).toEqual({ valor_definido: 0, justificativa: 'Peça já comprada' });
  });

  it('D2: a revision keeps the previous record and requires the revision reason', async () => {
    const original = {
      id_avaliacao: 30, id_avaliacao_revisada: null, tipo: 'ORIGINAL' as const, valor_definido: 40, justificativa: 'Parte da peça',
      motivo_revisao: null, id_usuario: 2, nome_usuario: 'Ana', data_avaliacao: '2026-11-05T11:00:00Z',
    };
    await criar('ATENDENTE', encerradaImpossibilidade(), {
      execucao, pagamentos,
      avaliacao: { ...avaliacaoPendente, pendente: false, vigente: original, avaliacoes: [original], total_disponivel: 80, total_reembolsado_avaliacao: 20, saldo_a_reembolsar: 20 },
    });
    expect(texto()).not.toContain('Avaliação obrigatória pendente');
    expect(texto()).toContain('Avaliação original');
    expect(texto()).toContain('Vigente');
    expect(botao('Registrar avaliação')).toBeUndefined();

    // O reembolso já começa limitado ao que a avaliação ainda permite (R$ 20, não os R$ 100 do pagamento)
    botao('Reembolsar')!.click();
    fixture.detectChanges();
    expect((el().querySelector('#valor-reembolso-8') as HTMLInputElement).value).toBe('20');
    botao('Voltar')!.click();
    fixture.detectChanges();

    botao('Registrar revisão')!.click();
    fixture.detectChanges();
    preencher('#campo-valor-definido', '60');
    preencher('#campo-justificativa-avaliacao', 'Fornecedor aceitou devolução');
    botao('Continuar')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('Informe a justificativa e o motivo da revisão.');

    preencher('#campo-motivo-revisao', 'Valor recalculado');
    botao('Continuar')!.click();
    fixture.detectChanges();
    botao('Confirmar registro')!.click();
    const req = backend.expectOne(`${API}/ordens-servico/2/avaliacao-financeira/revisoes`);
    expect(req.request.body).toEqual({
      id_avaliacao_revisada: 30, valor_definido: 60, justificativa: 'Fornecedor aceitou devolução', motivo_revisao: 'Valor recalculado',
    });
  });

  it('D7: attendant registers an accessory in an active order; the option disappears from CONCLUIDA on', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_ANALISE', tecnico }), { execucao });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    botao('Registrar acessório')!.click();
    backend.expectOne(`${API}/acessorios`).flush([{ id_acessorio: 3, descricao: 'Carregador', preco_atual: null, ativo: 1 }]);
    fixture.detectChanges();
    preencher('#campo-acessorio', '3');
    preencher('#campo-quantidade-acessorio', '2');
    botao('Registrar')!.click();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `${API}/ordens-servico/2/acessorios`);
    expect(req.request.body).toEqual([{ id_acessorio: 3, quantidade: 2, observacoes: null }]);
    req.flush({ mensagem: 'ok', registros: [] });
    responderRecarga(detalhes({ status: 'EM_ANALISE', tecnico }), { execucao });

    for (const status of ['CONCLUIDA', 'AGUARDANDO_EXPEDICAO', 'FINALIZADA'] as const) {
      responderRecargaManual(status);
      expect(botao('Registrar acessório')).toBeUndefined();
      expect(el().querySelector('button[aria-label="Editar 1× Carregador (registro nº 1)"]')).toBeNull();
    }
  });

  it('D7: attendant edits a received accessory; only the edit form is sent, with no delete option', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_REPARO', tecnico }), { execucao });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();
    expect(botao('Excluir')).toBeUndefined();

    el().querySelector<HTMLButtonElement>('button[aria-label="Editar 1× Carregador (registro nº 1)"]')!.click();
    backend.expectOne(`${API}/acessorios`).flush([
      { id_acessorio: 3, descricao: 'Carregador', preco_atual: null, ativo: 1 },
      { id_acessorio: 4, descricao: 'Fonte', preco_atual: null, ativo: 1 },
    ]);
    fixture.detectChanges();
    expect(texto()).toContain('Alterar acessório recebido');
    expect((el().querySelector('#campo-quantidade-acessorio') as HTMLInputElement).value).toBe('1');
    expect(texto()).toContain('valores anteriores e novos');

    preencher('#campo-quantidade-acessorio', '3');
    preencher('#campo-obs-acessorio', 'Com cabo');
    botao('Salvar alteração')!.click();
    const req = backend.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/ordens-servico/2/acessorios/1`);
    expect(req.request.body).toEqual({ id_acessorio: 3, quantidade: 3, observacoes: 'Com cabo' });
    req.flush({ mensagem: 'Acessório recebido alterado.', registro: {} });
    responderRecarga(detalhes({ status: 'EM_REPARO', tecnico }), { execucao });
    expect(texto()).toContain('Acessório recebido alterado.');
  });

  it('D7: the assigned technician can register accessories; the history labels the event', async () => {
    await criar('TECNICO', detalhes({ status: 'EM_REPARO', tecnico }), {
      execucao,
      historico: [{
        id_historico: 1, id_os: 2, id_usuario: 7, nome_usuario: 'Tecnico Teste', tipo_evento: 'ACESSORIO',
        descricao: 'Acessório recebido registrado: 2× Carregador.', data_evento: '2026-11-04T10:00:00Z',
        dados_anteriores: null, dados_novos: { descricao_acessorio: 'Carregador', quantidade: 2 },
      }],
    });
    expect(botao('Registrar acessório')).toBeDefined();
    const historico = el().querySelector('app-secao-historico')!.textContent!;
    expect(historico).toContain('Acessório');
    expect(historico).toContain('quantidade: 2');
  });

  it('technician does not see payments at all (P3)', async () => {
    await criar('TECNICO', detalhes({ status: 'EM_REPARO', tecnico }), { execucao, pagamentos });
    expect(el().querySelector('app-secao-pagamentos')).toBeNull();
    expect(texto()).not.toContain('Pagamento nº 9');
    expect(botao('Registrar pagamento')).toBeUndefined();
    expect(botao('Confirmar recebimento')).toBeUndefined();
    expect(botao('Reembolsar')).toBeUndefined();
  });

  it('technician concludes the repair after confirming, only when the completion date exists', async () => {
    const os = detalhes({ status: 'EM_REPARO', tecnico });
    await criar('TECNICO', os, { execucao });
    expect(botao('Concluir reparo')).toBeUndefined();
    expect(texto()).toContain('o técnico registra a data de conclusão no laudo');
  });

  it('technician concludes the repair', async () => {
    const os = detalhes({ status: 'EM_REPARO', tecnico });
    await criar('TECNICO', os, { execucao: { ...execucao, data_conclusao: '2026-11-04T10:00:00Z' } });

    botao('Concluir reparo')!.click();
    fixture.detectChanges();
    botao('Confirmar conclusão')!.click();
    const req = backend.expectOne(`${API}/ordens-servico/2/execucao/concluir`);
    expect(req.request.method).toBe('PATCH');
  });

  it('attendant registers a shipment and dispatches it with a tracking code', async () => {
    const quitado: PagamentosOs = { pagamentos: [], resumo: { tem_orcamento_aprovado: true, total_orcado: 100, total_pago: 100, pagamentos_pendentes: 0, saldo_devedor: 0 } };
    const os = detalhes({ status: 'CONCLUIDA', tecnico });
    await criar('ATENDENTE', os, { execucao, pagamentos: quitado });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    botao('Registrar devolução')!.click();
    fixture.detectChanges();
    el().querySelector<HTMLInputElement>('input[name="forma-entrega"][value="ENVIO"]')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    botao('Registrar')!.click();
    const registro = backend.expectOne(`${API}/ordens-servico/2/expedicao`);
    expect(registro.request.body).toEqual({ forma_entrega: 'ENVIO', codigo_rastreio: null });
    registro.flush({ mensagem: 'ok' });

    const expedicao: Expedicao = { id_expedicao: 1, data_envio: null, forma_entrega: 'ENVIO', codigo_rastreio: null, status: 'PENDENTE', data_entrega: null };
    responderRecarga({ ...os, status: 'AGUARDANDO_EXPEDICAO' }, { execucao, pagamentos: quitado, expedicao });

    botao('Marcar como despachado')!.click();
    fixture.detectChanges();
    preencher('#campo-rastreio-despacho', 'BR123');
    botao('Confirmar')!.click();
    const despacho = backend.expectOne(`${API}/expedicoes/2/status`);
    expect(despacho.request.body).toEqual({ status: 'EM_TRANSITO', codigo_rastreio: 'BR123' });
  });

  it('shipment is not offered while there is an outstanding balance', async () => {
    const devendo: PagamentosOs = { pagamentos: [], resumo: { tem_orcamento_aprovado: true, total_orcado: 100, total_pago: 40, pagamentos_pendentes: 0, saldo_devedor: 60 } };
    await criar('ATENDENTE', detalhes({ status: 'CONCLUIDA', tecnico }), { execucao, pagamentos: devendo });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    expect(botao('Registrar devolução')).toBeUndefined();
    expect(texto()).toContain('A devolução exige a quitação do orçamento aprovado.');
  });

  it('shows the recorded history chronologically with the user and the changes', async () => {
    const historico: EventoHistorico[] = [
      { id_historico: 1, id_os: 2, id_usuario: 6, nome_usuario: 'Ana Atendente', tipo_evento: 'CRIACAO', descricao: 'OS aberta na solicitação nº 9.', data_evento: '2026-11-01T10:00:00Z', dados_anteriores: null, dados_novos: { status: 'RECEBIDA' } },
      { id_historico: 2, id_os: 2, id_usuario: 7, nome_usuario: 'Tecnico Teste', tipo_evento: 'GARANTIA', descricao: 'Garantia definida como NAO.', data_evento: '2026-11-02T10:00:00Z', dados_anteriores: { garantia_status: 'PENDENTE' }, dados_novos: { garantia_status: 'NAO' } },
      { id_historico: 3, id_os: 2, id_usuario: null, nome_usuario: null, tipo_evento: 'ORCAMENTO', descricao: 'Orçamento nº 5 vencido sem resposta.', data_evento: '2026-11-05T10:00:00Z', dados_anteriores: { status: 'PENDENTE' }, dados_novos: { status: 'VENCIDO' } },
    ];
    await criar('TECNICO', detalhes({ tecnico }), { historico });

    const itens = [...el().querySelectorAll('.linha-tempo li')].map((li) => li.textContent!.replace(/\s+/g, ' '));
    expect(itens.length).toBe(3);
    expect(itens[0]).toContain('Ana Atendente');
    expect(itens[0]).toContain('situação: Recebida');
    expect(itens[1]).toContain('garantia: Pendente → Não');
    expect(itens[2]).toContain('Automático (sistema)');
    expect(itens[2]).toContain('situação: Pendente → Vencido');
    expect(texto()).not.toContain('foi aberta antes do histórico');
  });

  it('U1: history shows the technician name instead of the id and amounts as currency', async () => {
    const historico: EventoHistorico[] = [
      { id_historico: 1, id_os: 2, id_usuario: 6, nome_usuario: 'Ana Atendente', tipo_evento: 'ATRIBUICAO_TECNICO', descricao: 'Técnico atribuído à OS.', data_evento: '2026-11-01T10:00:00Z', dados_anteriores: { id_tecnico: null }, dados_novos: { id_tecnico: 7 } },
      { id_historico: 2, id_os: 2, id_usuario: 7, nome_usuario: 'Tecnico Teste', tipo_evento: 'ORCAMENTO', descricao: 'Orçamento nº 5 emitido.', data_evento: '2026-11-02T10:00:00Z', dados_anteriores: { status_os: 'EM_ANALISE' }, dados_novos: { status: 'PENDENTE', status_os: 'AGUARDANDO_APROVACAO', valor: 100 } },
      { id_historico: 3, id_os: 2, id_usuario: 6, nome_usuario: 'Ana Atendente', tipo_evento: 'ATRIBUICAO_TECNICO', descricao: 'Técnico trocado.', data_evento: '2026-11-03T10:00:00Z', dados_anteriores: { id_tecnico: 7 }, dados_novos: { id_tecnico: 99 } },
    ];
    await criar('TECNICO', detalhes({ tecnico }), { historico });

    const itens = [...el().querySelectorAll('.linha-tempo li')].map((li) => li.textContent!.replace(/\s+/g, ' '));
    expect(itens[0]).toContain('técnico: — → Tecnico Teste');
    expect(itens[1]).toContain('OS: Em análise → Aguardando aprovação');
    expect(itens[1]).toMatch(/valor: R\$\s?100,00/);
    // Técnico sem nome conhecido pela página: mostra o número
    expect(itens[2]).toContain('técnico: Tecnico Teste → nº 99');
  });

  it('falls back to the derived timeline for orders without recorded events', async () => {
    await criar('TECNICO', detalhes({ tecnico }));
    expect(texto()).toContain('foi aberta antes do histórico');
    expect(texto()).toContain('Ordem de Serviço aberta');
  });

  it('closing: attendant sees only the customer withdrawal and must confirm', async () => {
    await criar('ATENDENTE', detalhes({ status: 'EM_ANALISE', tecnico }), { execucao });
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    fixture.detectChanges();

    const opcoes = [...el().querySelectorAll<HTMLInputElement>('input[name="tipo-encerramento"]')].map((i) => i.value);
    expect(opcoes).toEqual(['DESISTENCIA_CLIENTE']);

    el().querySelector<HTMLInputElement>('input[name="tipo-encerramento"]')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    botao('Encerrar sem reparo')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('Informe a justificativa.');
    backend.expectNone(`${API}/ordens-servico/2/encerramento`);

    preencher('#campo-justificativa-encerramento', 'Cliente desistiu');
    botao('Encerrar sem reparo')!.click();
    fixture.detectChanges();
    expect(texto()).toContain('Esta ação não pode ser desfeita.');
    botao('Confirmar encerramento')!.click();

    const req = backend.expectOne(`${API}/ordens-servico/2/encerramento`);
    expect(req.request.body).toEqual({ tipo_encerramento: 'DESISTENCIA_CLIENTE', motivo_encerramento: 'Cliente desistiu' });
  });

  it('closing: technician with diagnosis in repair sees only technical impossibility; nothing after conclusion', async () => {
    await criar('TECNICO', detalhes({ status: 'EM_REPARO', tecnico }), { execucao });
    const opcoes = [...el().querySelectorAll<HTMLInputElement>('input[name="tipo-encerramento"]')].map((i) => i.value);
    expect(opcoes).toEqual(['IMPOSSIBILIDADE_TECNICA']);
  });

  it('closing: no option once the repair is concluded', async () => {
    await criar('TECNICO', detalhes({ status: 'CONCLUIDA', tecnico }), { execucao });
    expect(el().querySelector('input[name="tipo-encerramento"]')).toBeNull();
    expect(texto()).not.toContain('Encerrar sem reparo');
  });
});

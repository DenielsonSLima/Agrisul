# Referência do módulo de pesagens de cana

## Documentos analisados

Planilha fornecida: `COMPARATIVO PESAGEM DE CANA AGRISUL X TAQUARI SAFRA 2026-2027 - DIA 19.xlsx`. Possui quatro abas diárias: `16.10.26`, `17.10.26`, `18.10.26` e `19.10.26`.

As nove fotografias fornecidas mostram fichas manuscritas de pesagem. Há fotografias repetidas ou sobrepostas da mesma folha; elas são referências de operação e não representam nove conjuntos independentes de dados. Não haverá transcrição ou importação automática dos manuscritos.

## Estrutura encontrada

A ficha de campo contém data, número da frota, placa, tipo, peso da tara, peso bruto, peso líquido e hora. Uma viagem reúne um caminhão e dois reboques. Todos os 44 conjuntos presentes no Excel seguem essa composição, inclusive um conjunto com taras pendentes em 19/10.

No Excel, cada conjunto ocupa três linhas de veículos, seguidas de um subtotal. As colunas são:

| Coluna | Conteúdo |
| --- | --- |
| A | Data, informada na primeira linha do dia, ou identificação do subtotal |
| B | Identificação do veículo: número da frota do caminhão ou placa do reboque |
| C | Tara AGRISUL |
| D | Peso bruto AGRISUL |
| E | Peso líquido AGRISUL calculado |
| F | Peso líquido informado pelo parceiro TAQUARI |
| G | Diferença entre o líquido do parceiro e o líquido AGRISUL |

Embora os cabeçalhos do Excel indiquem quilogramas, as células numéricas usam escala de toneladas: `16.68` corresponde à tara manuscrita de `16.680 kg`. O módulo adota quilogramas explicitamente nas entradas, nas saídas da RPC e nos rótulos. Isso evita ambiguidade de escala.

O Excel não registra a hora ou a placa do caminhão nas linhas de comparativo, mas essas informações existem nas fichas e podem ser conservadas no módulo.

## Fórmulas e estados de preenchimento

Todos os cálculos de negócio pertencem ao Postgres, com `NUMERIC`, por meio da RPC de negócio. O frontend apenas envia entradas e apresenta o resultado.

- Líquido AGRISUL por componente: `bruto − tara`, somente quando os dois valores estão preenchidos.
- Diferença por componente: `líquido do parceiro − líquido AGRISUL`, somente quando ambos estão preenchidos.
- Tara, bruto e líquido AGRISUL do conjunto: soma dos três componentes; o resultado completo depende dos três componentes correspondentes preenchidos.
- Líquido do parceiro no conjunto: soma dos componentes informados, com indicação de parcial quando ainda faltar algum.
- Diferença do conjunto: `total líquido do parceiro − total líquido AGRISUL`, somente quando o conjunto estiver completo dos dois lados.
- Diferença percentual: `(total líquido do parceiro / total líquido AGRISUL − 1) × 100`, somente com ambos os lados completos e base AGRISUL diferente de zero.
- Totais do período: soma dos conjuntos, sem duplicar os subtotais. Totais parciais precisam ser identificados como parciais. A diferença final e seu percentual dependem da conclusão de todos os conjuntos incluídos no escopo.

Diferença negativa significa que o parceiro informou menos peso líquido que a AGRISUL. Diferença positiva significa mais peso informado pelo parceiro. Um valor pendente é `null`, distinto de zero. Nenhuma ausência de pesagem deve aparecer como perda de 100%.

O arquivo de 19/10 confirma a necessidade de salvar um conjunto incompleto: o caminhão 136 e seus dois reboques possuem pesos brutos, mas as três taras estão ausentes. Os líquidos do parceiro também estão pendentes em todo o dia.

## Bruto dos reboques em conjunto

As fichas usam duas maneiras de registrar o bruto dos reboques:

1. **Individual:** cada reboque possui seu próprio peso bruto. As primeiras viagens de 16/10 apresentam valores como `26.930 kg` em cada reboque.
2. **Em conjunto:** uma seta une os dois reboques e registra um único bruto para ambos. Para montar o comparativo, o Excel divide esse bruto igualmente entre os dois reboques e calcula o líquido de cada um com sua tara individual.

O módulo deve preservar a entrada original do peso conjunto e realizar esse rateio no banco. O peso bruto e o líquido apresentados por reboque nesse modo são valores de rateio para o comparativo. O rótulo deve explicitar isso. O bruto conjunto não deve ser somado duas vezes.

O rateio não deve ser arredondado previamente para duas casas de tonelada. Por exemplo, `54.490 kg ÷ 2 = 27.245 kg`. Valores impares em quilogramas também podem produzir meio quilograma por reboque, que deve ser preservado.

### Exemplo completo de 16/10

Conjunto do caminhão 133:

| Componente | Tara kg | Bruto kg | Líquido AGRISUL kg | Líquido TAQUARI kg | Diferença kg |
| --- | ---: | ---: | ---: | ---: | ---: |
| Caminhão 133 | 16.400 | 38.860 | 22.460 | 22.710 | +250 |
| Reboque OEK-4136 | 10.320 | 27.610, por rateio | 17.290 | 20.600 | +3.310 |
| Reboque OEK-4276 | 10.320 | 27.610, por rateio | 17.290 | 13.150 | −4.140 |
| Total | 37.040 | 94.080 | 57.040 | 56.460 | −580 |

O bruto manuscrito dos dois reboques é `55.220 kg`; o banco calcula `55.220 ÷ 2 = 27.610 kg` para cada um. O líquido AGRISUL conjunto também pode ser conferido diretamente: `38.860 + 55.220 − 16.400 − 10.320 − 10.320 = 57.040 kg`.

## Totais de referência e problema da aba de 18/10

| Dia | Conjuntos reais | Líquido AGRISUL kg | Líquido TAQUARI kg | Diferença kg | Diferença percentual |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16/10/2026 | 7 | 394.550 | 385.620 | −8.930 | −2,26333797997719% |
| 17/10/2026 | 9 | 483.590 | 469.920 | −13.670 | −2,82677474720321% |
| 18/10/2026 | 15 | 732.410 | 737.700 | +5.290 | +0,72227304378695% |
| 19/10/2026 | 13 | 571.998, parcial: 12 conjuntos completos | Pendente | Pendente | Pendente |

A aba de 18/10 contém um problema de fórmula/estrutura que não deve ser reproduzido. O conjunto das linhas 61 a 63 está preenchido, mas seu subtotal na linha 64 foi perdido. O total geral ainda referencia esse subtotal vazio. Há também uma faixa vazia nas linhas 65 a 67 e um subtotal zerado na linha 68; a contagem fixa de 48 componentes impede a apresentação da diferença final.

O Excel exibe `683.950 kg` de AGRISUL e `686.080 kg` do parceiro. Essas somas omitem `48.460 kg` e `51.620 kg`, respectivamente, do conjunto do caminhão 135 das 22:10:

- Caminhão: bruto `35.100`, tara `17.320`, líquido AGRISUL `17.780`, parceiro `17.710` kg.
- Reboque 1: bruto por rateio `25.640`, tara `10.300`, líquido AGRISUL `15.340`, parceiro `16.880` kg.
- Reboque 2: bruto por rateio `25.640`, tara `10.300`, líquido AGRISUL `15.340`, parceiro `17.030` kg.

Somando os componentes reais, os totais corretos de 18/10 são os mostrados na tabela. A soma relacional no banco deve eliminar a dependência de posições de linhas, espaços vazios ou subtotais manuais.

## Fluxo proposto

1. Criar um comparativo selecionando a data de início e um parceiro cadastrado. Safra e observações podem complementar a identificação.
2. Abrir o comparativo e adicionar viagens. Cada viagem tem uma data efetiva, hora opcional, caminhão e dois reboques. A data efetiva pode avançar conforme o trabalho continua nos dias seguintes.
3. Informar frota, placa, tara e bruto. Escolher se o bruto dos reboques foi medido individualmente ou em conjunto.
4. Salvar mesmo com informações pendentes, identificando os conjuntos incompletos e os valores calculáveis.
5. Preencher ou corrigir os líquidos informados pelo parceiro quando forem recebidos.
6. Consultar os conjuntos, diferenças e totais do período, com estados parciais claramente apresentados.

A passagem da meia-noite não deve alterar a data silenciosamente. As fichas mostram o novo dia escrito no meio da folha; por isso a data efetiva de cada viagem precisa continuar acessível ao operador.

## Reunião entre os três agentes

O trabalho foi dividido entre análise da planilha e das fichas, modelagem no Supabase e implementação da interface. Os agentes compartilharam as conclusões durante a execução:

- **Análise da planilha:** extraiu abas, células e fórmulas diretamente do XLSX, identificou a escala real dos pesos, confirmou o rateio dos brutos conjuntos e detectou o subtotal perdido em 18/10.
- **Banco de dados:** recebeu as fórmulas, as regras de preenchimento incompleto, os casos de bruto individual/conjunto e os totais exatos para implementar e verificar os cálculos nas RPCs.
- **Interface:** recebeu os campos de operação, as escolhas de unidade, a necessidade de preservar a data por viagem, os estados pendentes e a identificação visual dos valores rateados.

A decisão de reproduzir o rateio igual foi discutida explicitamente: calcular apenas o total dos reboques sem líquidos por componente deixaria de apresentar o comparativo individual que já existe no Excel. A referência adotada conserva os valores originais e calcula o rateio de forma explícita no banco.

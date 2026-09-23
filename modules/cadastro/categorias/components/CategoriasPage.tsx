'use client';

import Link from 'next/link';
import {useMemo, useState} from 'react';
import {
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from 'lucide-react';
import {LocalSearch} from '@/shared/components/Common';
import {notifications, useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {sortCategoriesAlphabetically} from '../categoryOrdering';
import {useMaterialCategories, useMaterialCategoryMutations} from '../hooks/useMaterialCategories';
import type {MaterialCategory} from '../types';
import {CategoryForm} from './CategoryForm';
import '../styles.css';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function CategoriasPage() {
  const query = useMaterialCategories();
  const mutations = useMaterialCategoryMutations();
  const confirm = useConfirmation();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MaterialCategory | null | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const matches = term
      ? query.categories.filter(category =>
          category.name.toLocaleLowerCase('pt-BR').includes(term),
        )
      : query.categories;
    return sortCategoriesAlphabetically(matches);
  }, [query.categories, search]);

  const remove = async (category: MaterialCategory) => {
    const accepted = await confirm({
      title: 'Excluir categoria?',
      description: `A categoria “${category.name}” será excluída. Se houver materiais vinculados, a exclusão será impedida para preservar os cadastros.`,
      confirmLabel: 'Excluir categoria',
      tone: 'destructive',
    });
    if (!accepted) return;

    setDeletingId(category.id);
    try {
      await mutations.remove(category.id);
      notifications.deleted(`A categoria “${category.name}” foi excluída.`);
    } catch (reason) {
      notifications.error(
        (reason as Error).message || 'Não foi possível excluir a categoria.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const addButton = (
    <button
      type="button"
      className="btn company-primary"
      onClick={() => setEditing(null)}
      disabled={mutations.saving || mutations.deleting}
    >
      <Plus size={17}/>
      Cadastrar categoria
    </button>
  );

  return (
    <section className="categories-workspace">
      <nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação">
        <ModuleLink href="/cadastro">Cadastros</ModuleLink>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Categorias</span>
      </nav>

      <div className="companies-heading">
        <div>
          <h2>Categorias</h2>
          <p>Organize os materiais em grupos para facilitar consultas e cotações.</p>
        </div>
        {!query.loading && !query.error ? addButton : null}
      </div>

      {!query.loading && !query.error && query.categories.length > 0 && (
        <div className="categories-toolbar">
          <LocalSearch
            value={search}
            onChange={setSearch}
            placeholder="Buscar categoria…"
          />
          <span>
            {filteredCategories.length} de {query.categories.length}{' '}
            {query.categories.length === 1 ? 'categoria' : 'categorias'}
          </span>
        </div>
      )}

      {query.loading ? (
        <div className="client-loading" role="status">
          <Loader2 size={20} className="animate-spin"/>
          Carregando categorias…
        </div>
      ) : query.error ? (
        <div className="company-empty" role="alert">
          <h3>{query.status === 401 ? 'Acesse suas categorias' : 'Não foi possível carregar as categorias'}</h3>
          <p>{query.error}</p>
          {query.status === 401 ? (
            <Link
              className="btn company-primary"
              href="/login?returnTo=%2Fcadastro%3Fsecao%3Dcategorias"
              target="_top"
            >
              Entrar
            </Link>
          ) : (
            <button type="button" className="btn" onClick={() => void query.reload()}>
              <RefreshCw size={16}/>
              Tentar novamente
            </button>
          )}
        </div>
      ) : query.categories.length === 0 ? (
        <div className="company-empty">
          <span className="company-empty-icon"><Tags size={25}/></span>
          <h3>Nenhuma categoria cadastrada</h3>
          <p>Cadastre a primeira categoria para separar e localizar os materiais com rapidez.</p>
          {addButton}
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="company-empty">
          <span className="company-empty-icon"><Search size={25}/></span>
          <h3>Nenhuma categoria encontrada</h3>
          <p>Ajuste a busca para localizar outra categoria.</p>
          <button type="button" className="btn" onClick={() => setSearch('')}>
            Limpar busca
          </button>
        </div>
      ) : (
        <div className="categories-table-wrap">
          <table className="categories-table">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col">Última atualização</th>
                <th scope="col" className="categories-actions-heading">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map(category => {
                const deleting = deletingId === category.id;
                return (
                  <tr key={category.id}>
                    <td>
                      <span className="category-name-cell">
                        <span aria-hidden="true"><FolderOpen size={17}/></span>
                        <strong>{category.name}</strong>
                      </span>
                    </td>
                    <td className="category-date-cell">{formatDate(category.updatedAt)}</td>
                    <td>
                      <div className="category-row-actions">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => setEditing(category)}
                          disabled={mutations.saving || mutations.deleting}
                        >
                          <Pencil size={14}/>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="icon-btn category-delete"
                          aria-label={`Excluir categoria ${category.name}`}
                          title="Excluir categoria"
                          onClick={() => void remove(category)}
                          disabled={mutations.saving || mutations.deleting}
                        >
                          {deleting ? <Loader2 size={15} className="animate-spin"/> : <Trash2 size={15}/>} 
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <CategoryForm
          category={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSave={async input => {
            const saved = await mutations.save(input);
            notifications[input.id ? 'updated' : 'created'](
              input.id
                ? `A categoria “${saved.name}” foi atualizada.`
                : `A categoria “${saved.name}” foi cadastrada.`,
            );
            setEditing(undefined);
            return saved;
          }}
        />
      )}
    </section>
  );
}

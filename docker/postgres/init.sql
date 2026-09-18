-- Executado apenas na criação do volume de dados.
-- btree_gist é pré-requisito da exclusion constraint booking_no_overlap (F0.2).
CREATE EXTENSION IF NOT EXISTS btree_gist;
